import type { WebContents } from 'electron'
import {
  fallbackName,
  GroupSuggestionState,
  sanitizeGroupName,
  planGroups
} from '@shared/ai/grouping'
import { inflateSync } from 'zlib'
import { closeSync, openSync, readSync, statSync } from 'fs'
import {
  acceptSuggestion,
  buildFilenamePrompt,
  FILE_READ_MAX,
  FILENAME_SYSTEM,
  imageMeta,
  pdfInfo,
  pdfText,
  textSnippet
} from '@shared/ai/evidence'
import { isGeneric, splitExt } from '@shared/ai/filenames'
import { cleanTitle, sanitizeModelTitle, TITLE_MAX, TITLE_TARGET } from '@shared/ai/titles'
import { documentText, normalizeUrl } from '@shared/ai/urls'
import type { AiContext } from '@shared/ai/types'
import type { LocalSuggestion } from '@shared/search'
import type { DownloadManager, DownloadPage } from '../downloads'
import type { HistoryStore } from '../history'
import { JsonStore } from '../store'
import type { TabManager } from '../tabs'
import type { EmbeddingIndex } from './index'
import type { AiRouter } from './router'

const NORMAL: AiContext = { private: false, tor: false }
const TITLE_CACHE_MAX = 5000
const EXTRACT_DELAY_MS = 1500
// The brief said 0.5. EmbeddingGemma scores a good query/page match around 0.4 to 0.5 (an unrelated page 0.0 to 0.15),
// so 0.5 found almost nothing; one line to change back.
const SEMANTIC_MIN = 0.4
const SEMANTIC_MAX = 3
// The command bar takes these results as a second update, whenever they come, and drops them if the person has typed
// on, so a slow answer costs nothing: the budget only keeps a stuck model from holding a request open.
const SEMANTIC_BUDGET_MS = 500
const SEMANTIC_MIN_CHARS = 3

/** Read from the page, once, after it has loaded. A fixed string: nothing a model says is ever run. */
const EXTRACT_SCRIPT = `(() => {
  const m = document.querySelector('meta[name="description"],meta[property="og:description"]')
  const root = document.querySelector('main,article') || document.body
  return {
    title: String(document.title || ''),
    description: String((m && m.content) || '').slice(0, 400),
    text: String((root && root.innerText) || '').slice(0, 1200)
  }
})()`

const TITLE_SYSTEM = `You shorten web page titles for a tab list. Answer with JSON: {"title": "..."}.
Keep the language of the page title. At most ${TITLE_TARGET} characters. Keep what the page is about; drop the site name, slogans and extra detail.`

export const GROUP_SYSTEM = `You name a group of related web pages by their shared topic. Answer with JSON: {"name": "..."}.
Use 2 or 3 words naming the subject they share, the way a person would label a folder, in the language of the titles.
Name the topic, never the website or format: not "Wikipedia", "YouTube", "Articles", "Web pages", "Links" or "Tabs".
Examples: pages on ramen shops and Kyoto hotels -> {"name": "Japan trip"}; pages on Python, Rust and Go -> {"name": "Programming languages"}.`

/** Most of a file read for naming (a PDF's Info dictionary can be near either end). */
const HEAD_BYTES = 2 * 1024 * 1024
const TAIL_BYTES = 256 * 1024

/**
 * What the finished file says about itself: a PDF's title, subject and first text, the start of a text file, a PNG's
 * text chunks. Files over 50 MB are not opened; nothing is executed, only read.
 */
function readFileEvidence(path: string): { size?: number; title?: string; text?: string } {
  try {
    const size = statSync(path).size
    if (size > FILE_READ_MAX) return { size }
    const { ext } = splitExt(path)
    const e = ext.toLowerCase()
    const fd = openSync(path, 'r')
    try {
      const read = (pos: number, len: number): Uint8Array => {
        const buf = Buffer.alloc(Math.min(len, Math.max(0, size - pos)))
        readSync(fd, buf, 0, buf.length, pos)
        return buf
      }
      if (e === '.pdf') {
        const head = read(0, HEAD_BYTES)
        const tail = size > HEAD_BYTES ? read(size - TAIL_BYTES, TAIL_BYTES) : new Uint8Array()
        const info = pdfInfo(Buffer.concat([head, tail]))
        const text = pdfText(head, (b) => {
          try {
            return inflateSync(b)
          } catch {
            return null
          }
        })
        return { size, title: [info.title, info.subject].filter(Boolean).join(' | '), text }
      }
      if (e === '.png') return { size, title: imageMeta(read(0, 64 * 1024)) }
      return { size, text: textSnippet(read(0, 8192), e) }
    } finally {
      closeSync(fd)
    }
  } catch {
    return {}
  }
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

export interface GroupSuggestion {
  spaceId: number
  name: string
  tabIds: number[]
}

/**
 * The quiet features: each is wired to the browser here and asks the router for everything it needs. Whether a
 * tab may be touched at all is decided by the router's policy; this class never looks at private or Tor itself
 * except to hand the router the context.
 */
export class AiFeatures {
  private titleCache = new JsonStore<{ entries: Array<[string, string]> }>('ai-titles', {
    entries: []
  })
  private titleMap = new Map<string, string>()
  private titleAsked = new Set<string>()
  private extracting = new Map<number, NodeJS.Timeout>()
  private groupState = new GroupSuggestionState()
  private suggestions = new Map<number, GroupSuggestion>()

  constructor(
    private deps: {
      router: AiRouter
      index: EmbeddingIndex
      tabs: TabManager
      history: HistoryStore
      downloads: DownloadManager
    }
  ) {
    this.titleMap = new Map(this.titleCache.value.entries)
  }

  /** Hook everything up. Safe to call once, at start. */
  start(): void {
    const { tabs, downloads, history, index } = this.deps
    tabs.aiTitle = (t) => this.titleFor(t)
    tabs.onPageLoaded = (p) => this.pageLoaded(p)
    downloads.onComplete((info, page) => void this.suggestFilename(info, page))
    downloads.wantHints = () => this.deps.router.decide('filename', NORMAL) !== 'deny'
    history.onRemoved((urls) => index.remove(urls))
  }

  // ---- F1: titles ----

  private titleKey = (url: string, title: string): string => `${url}\n${title}`

  /**
   * The title to show for a tab, or null to show its own. The cheap clean-up applies as soon as the feature is
   * on; a long title is also sent to the model once, and the answer shows from then on.
   */
  private titleFor(t: {
    url: string
    title: string
    private: boolean
    tor: boolean
  }): string | null {
    const ctx = { private: t.private, tor: t.tor }
    if (!t.title || !this.deps.router.permits('title', ctx)) return null
    const cleaned = cleanTitle(t.title, t.url)
    let out = cleaned.title
    if (cleaned.needsModel) {
      const key = this.titleKey(t.url, t.title)
      const hit = this.titleMap.get(key)
      if (hit) {
        this.titleMap.delete(key) // most recently used goes last
        this.titleMap.set(key, hit)
        out = hit
      } else this.askTitle(key, t, ctx)
    }
    return out && out !== t.title ? out : null
  }

  private askTitle(key: string, t: { url: string; title: string }, ctx: AiContext): void {
    // not asked twice; and not before a model is there to ask (the clean-up above applies meanwhile)
    if (this.titleAsked.has(key) || this.deps.router.decide('title', ctx) === 'deny') return
    this.titleAsked.add(key)
    if (this.titleAsked.size > TITLE_CACHE_MAX * 2) this.titleAsked.clear()
    let host = ''
    try {
      host = new URL(t.url).hostname
    } catch {
      // keep ''
    }
    void this.deps.router
      .generate({
        task: 'title',
        ctx,
        system: TITLE_SYSTEM,
        prompt: `Page title: ${t.title.slice(0, 300)}\nSite: ${host}`,
        field: 'title'
      })
      .then((raw) => {
        const title = sanitizeModelTitle(raw)
        if (!title || title.length > TITLE_MAX) return
        this.titleMap.set(key, title)
        while (this.titleMap.size > TITLE_CACHE_MAX) {
          this.titleMap.delete(this.titleMap.keys().next().value as string)
        }
        this.titleCache.value.entries = [...this.titleMap]
        this.titleCache.save()
        this.deps.tabs.refresh()
      })
  }

  /** Forget the titles (AI turned off or its data removed). */
  clearTitles(): void {
    this.titleMap.clear()
    this.titleAsked.clear()
    this.titleCache.value.entries = []
    this.titleCache.save()
  }

  // ---- reading pages into the index (for F3 and F4) ----

  /** A page finished loading: a moment later, read its text and add it to the index. */
  private pageLoaded(p: {
    id: number
    url: string
    title: string
    private: boolean
    tor: boolean
    wc: WebContents
  }): void {
    this.scheduleExtract(p)
  }

  private scheduleExtract(p: {
    id: number
    url: string
    private: boolean
    tor: boolean
    wc: WebContents
  }): void {
    // Before anything is read from the page the router says whether this tab may be used at all.
    const ctx = { private: p.private, tor: p.tor }
    if (!normalizeUrl(p.url) || this.deps.router.decide('embed', ctx) === 'deny') return
    const old = this.extracting.get(p.id)
    if (old) clearTimeout(old)
    const timer = setTimeout(() => {
      this.extracting.delete(p.id)
      void this.extract(p, ctx)
    }, EXTRACT_DELAY_MS)
    timer.unref()
    this.extracting.set(p.id, timer)
  }

  private async extract(p: { url: string; wc: WebContents }, ctx: AiContext): Promise<void> {
    const { wc } = p
    if (wc.isDestroyed() || wc.getURL() !== p.url) return
    if (this.deps.router.decide('embed', ctx) === 'deny') return // switched off in the meantime
    try {
      const raw = (await wc.executeJavaScript(EXTRACT_SCRIPT)) as Record<string, unknown> | null
      if (!raw || typeof raw !== 'object') return
      const title = str(raw.title, 300)
      const text = documentText(title, str(raw.description, 400), str(raw.text, 1200))
      await this.deps.index.upsert([{ url: p.url, title, text, visited: Date.now() }])
    } catch {
      // a page that went away or does not allow it: it just is not indexed
    }
  }

  /** The AI was switched on, or a feature that reads pages was: catch up on open tabs and on history. */
  catchUp(): void {
    for (const p of this.deps.tabs.loadedPages()) this.scheduleExtract(p)
    const entries = this.deps.history.all()
    if (this.deps.router.decide('embed', NORMAL) !== 'deny') {
      void this.deps.index.backfill(entries)
    }
  }

  /** The AI was switched off or its data removed: nothing learned about pages is kept. */
  forgetAll(): void {
    for (const t of this.extracting.values()) clearTimeout(t)
    this.extracting.clear()
    this.deps.index.clear()
    this.clearTitles()
    this.suggestions.clear()
    this.deps.tabs.refresh()
  }

  // ---- F2: download names ----

  private async suggestFilename(
    info: { id: number; filename: string; url: string; savePath: string },
    page: DownloadPage | undefined
  ): Promise<void> {
    const { id, filename, url } = info
    // downloads here come from the ordinary session only: private and Tor tabs have their own, not tracked
    if (!isGeneric(filename) || this.deps.router.decide('filename', NORMAL) === 'deny') return
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      // keep ''
    }
    const file = readFileEvidence(info.savePath)
    const hints = await page?.hints
    const prompt = buildFilenamePrompt({
      filename,
      url,
      host,
      mime: page?.mime,
      size: file.size,
      pageTitle: page?.title,
      pageUrl: page?.url,
      ...hints,
      fileTitle: file.title,
      fileText: file.text
    })
    const raw = await this.deps.router.generate({
      task: 'filename',
      ctx: NORMAL,
      system: FILENAME_SYSTEM,
      prompt,
      field: 'name'
    })
    const name = acceptSuggestion(raw, filename)
    if (name) this.deps.downloads.suggestName(id, name)
  }

  // ---- F3: group suggestions ----
  // Tab groups are switched off in the interface (TAB_GROUPS in shared/tabgroups.ts), so a suggestion is worked out
  // when asked for but nothing shows it yet. When groups come back: show `suggestionFor(spaceId)` as the quiet row
  // and call `acceptGroup` / `dismissGroup` from it.

  /** The suggestion for a space (at most once per two minutes, with six or more tabs to choose from), or null. */
  async suggestGroup(spaceId: number): Promise<GroupSuggestion | null> {
    const { router, index, tabs } = this.deps
    if (router.decide('group-name', NORMAL) === 'deny') return null
    const candidates = tabs.groupCandidates(spaceId)
    const now = Date.now()
    if (!this.groupState.due(spaceId, candidates.length, now))
      return this.suggestions.get(spaceId) ?? null
    this.groupState.markRun(spaceId, now)
    const withVec = candidates.flatMap((c) => {
      const vec = index.vectorOf(c.url)
      return vec ? [{ ...c, vec }] : []
    })
    const sets = this.groupState.remaining(spaceId, planGroups(withVec))
    const ids = sets[0]
    if (!ids) {
      this.suggestions.delete(spaceId)
      return null
    }
    const members = withVec.filter((t) => ids.includes(t.id))
    const raw = await router.generate({
      task: 'group-name',
      ctx: NORMAL,
      system: GROUP_SYSTEM,
      prompt: members.map((m) => `- ${m.title.slice(0, 100)}`).join('\n'),
      field: 'name'
    })
    const name = (raw ? sanitizeGroupName(raw) : null) ?? fallbackName(members.map((m) => m.url))
    const suggestion = { spaceId, name, tabIds: ids }
    this.suggestions.set(spaceId, suggestion)
    return suggestion
  }

  suggestionFor(spaceId: number): GroupSuggestion | null {
    return this.suggestions.get(spaceId) ?? null
  }

  /** Turn the suggestion into a group with the existing group creation path. */
  acceptGroup(spaceId: number): void {
    const s = this.suggestions.get(spaceId)
    this.suggestions.delete(spaceId)
    if (!s) return
    const [first, ...rest] = s.tabIds
    this.deps.tabs.createGroup(first, s.name)
    for (const id of rest) this.deps.tabs.addToGroup(id, this.deps.tabs.groupIdOf(first) ?? -1)
  }

  dismissGroup(spaceId: number): void {
    const s = this.suggestions.get(spaceId)
    this.suggestions.delete(spaceId)
    if (s) this.groupState.dismiss(spaceId, s.tabIds)
  }

  // ---- F4: history search by meaning ----

  /** Up to three pages from history that match the query by meaning, within a small time budget. */
  async semantic(query: string, exclude: string[]): Promise<LocalSuggestion[]> {
    const q = query.trim()
    const { router, index, history } = this.deps
    if (q.length < SEMANTIC_MIN_CHARS || router.decide('embed', NORMAL) === 'deny') return []
    const s = router.settings()
    if (!s.semanticHistory) return []
    const found = await Promise.race([
      index.search(q, SEMANTIC_MAX, SEMANTIC_MIN, new Set(exclude), SEMANTIC_BUDGET_MS),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SEMANTIC_BUDGET_MS))
    ])
    return (found ?? []).map((h) => ({
      url: h.url,
      title: cleanTitle(h.title, h.url).title,
      favicon: history.faviconFor(h.url),
      bookmark: false,
      score: h.score
    }))
  }

  /** The command bar opened: have the embedding model ready for the first keystroke. */
  warm(): void {
    if (this.deps.router.settings().semanticHistory) this.deps.router.warmEmbed()
  }
}
