import type { BrowserWindow } from 'electron'
import { SEARCH_ENGINES } from '@shared/settings'
import {
  downloadHits,
  guessIntent,
  hitKey,
  historyHits,
  mergeHits,
  parseModelIntent,
  tabHits,
  webQuery,
  type CanvasFoundEvent,
  type Hit,
  type Intent
} from '@shared/ai/canvasFind'
import type { AiContext } from '@shared/ai/types'
import type { DownloadManager } from '../downloads'
import type { HistoryStore } from '../history'
import type { SettingsStore } from '../settings'
import type { TabManager } from '../tabs'
import type { CanvasContent } from './canvasContent'
import type { EmbeddingIndex } from './index'
import type { AiRouter } from './router'

const NORMAL: AiContext = { private: false, tor: false }
const SEMANTIC_MIN = 0.4
const SEMANTIC_MAX = 8
const SEMANTIC_MS = 1500
const INTENT_MS = 2500
const WEB_MAX = 10

type FindEvent = CanvasFoundEvent extends infer E
  ? E extends { queryId: string }
    ? Omit<E, 'queryId'>
    : never
  : never

const INTENT_SYSTEM = `You decide what a person typed into a browser's search box means. Answer with JSON: {"intent": "find"} or {"intent": "ask"}.
"find": they want to open or find a page, a file, a site or a document.
"ask": they ask a question or want an explanation, a summary or a comparison.`

/**
 * The reading of a SERP, run in a hidden page: every outside link that looks like a result, with its title and the
 * text around it. A fixed string. Redirect wrappers of the big engines are undone.
 */
const SERP_SCRIPT = `(() => {
  const here = location.hostname.replace(/^www\\./, '')
  const un = (href) => {
    try {
      const u = new URL(href, location.href)
      for (const k of ['uddg', 'q', 'url']) {
        const v = u.searchParams.get(k)
        if (v && /^https?:\\/\\//.test(v) && u.hostname.replace(/^www\\./, '') .includes(here.split('.')[0])) return v
      }
      return u.href
    } catch (e) { return '' }
  }
  const seen = new Set()
  const out = []
  for (const a of document.querySelectorAll('a[href]')) {
    const href = un(a.getAttribute('href'))
    if (!/^https?:\\/\\//.test(href)) continue
    let host = ''
    try { host = new URL(href).hostname.replace(/^www\\./, '') } catch (e) { continue }
    if (host === here || host.endsWith('.' + here) || seen.has(href)) continue
    const head = a.querySelector('h1,h2,h3,h4')
    const title = ((head && head.innerText) || a.innerText || '').replace(/\\s+/g, ' ').trim()
    if (title.length < 12 || title.length > 180) continue
    if (/^https?:|\\u203a/.test(title) || /^\\S\\s/.test(title)) continue // the address line, not the headline
    if (a.closest('nav,header,footer,[role=navigation]')) continue
    const box = a.closest('article,li,[data-testid],.result,.g,.b_algo,div[class*="result"]') || a.parentElement
    let snippet = ((box && box.innerText) || '').replace(/\\s+/g, ' ').trim()
    if (snippet.startsWith(title)) snippet = snippet.slice(title.length).trim()
    seen.add(href)
    out.push({ url: href, title: title, snippet: snippet.slice(0, 240) })
    if (out.length >= 14) break
  }
  return out
})()`

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** A web search read in a hidden page (no tab): the results' address, title and snippet. */
export async function webSearch(
  content: CanvasContent,
  engineUrl: string,
  query: string,
  max = WEB_MAX
): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const raw = await content.hidden(engineUrl + encodeURIComponent(query.slice(0, 200)), (wc) =>
    wc.executeJavaScript(SERP_SCRIPT)
  )
  return (Array.isArray(raw) ? raw : []).slice(0, max).flatMap((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    const url = str(o.url, 1000)
    return /^https?:\/\//i.test(url)
      ? [{ url, title: str(o.title, 180), snippet: str(o.snippet, 240) }]
      : []
  })
}

/**
 * The canvas prompt's search: open tabs, then what the embedding index remembers of history, then downloaded files,
 * then the web, each reported as it is found. In a private or Tor window only the open tabs are searched, by words,
 * and nothing leaves the machine. Never throws: a source that fails is just empty.
 */
export class CanvasFinder {
  private running = new Map<string, AbortController>()

  constructor(
    private d: {
      tabs: TabManager
      history: HistoryStore
      downloads: DownloadManager
      index: EmbeddingIndex
      router: AiRouter
      settings: SettingsStore
      content: CanvasContent
    }
  ) {}

  cancel(queryId: string): void {
    this.running.get(queryId)?.abort()
  }

  /** Ask a small model, with a short fuse; null when it cannot say. */
  private async classify(query: string): Promise<Intent | null> {
    if (this.d.router.decide('chat', NORMAL) === 'deny') return null
    const raw = await Promise.race([
      this.d.router.generate({
        task: 'chat',
        ctx: NORMAL,
        system: INTENT_SYSTEM,
        prompt: query.slice(0, 300),
        field: 'intent'
      }),
      new Promise<null>((r) => setTimeout(() => r(null), INTENT_MS))
    ])
    return parseModelIntent(raw)
  }

  async run(
    win: BrowserWindow,
    req: { queryId: string; query: string; spaceId: number; classify: boolean }
  ): Promise<void> {
    const ctrl = new AbortController()
    this.running.set(req.queryId, ctrl)
    const emit = (e: FindEvent): void => {
      if (!win.isDestroyed() && !ctrl.signal.aborted) {
        win.webContents.send('canvas:found', { queryId: req.queryId, ...e })
      }
    }
    try {
      const tabs = this.d.tabs.canvasTabs(req.spaceId)
      const kind = this.d.tabs.boardKind()
      const guess = guessIntent(req.query)
      // a private or Tor window: the open tabs, by words, and that is all
      if (kind !== 'normal') {
        emit({ kind: 'intent', intent: 'find', docs: false })
        emit({
          kind: 'hits',
          source: 'tab',
          hits: tabHits(
            guess.terms,
            tabs.filter((t) => /^https?:/i.test(t.url))
          )
        })
        return emit({ kind: 'done' })
      }
      let intent = guess.intent
      if (req.classify && !guess.confident) intent = (await this.classify(req.query)) ?? intent
      emit({ kind: 'intent', intent, docs: guess.wantsDocs })
      const normal = tabs.filter((t) => !t.private && !t.tor && /^https?:/i.test(t.url))
      emit({ kind: 'hits', source: 'tab', hits: tabHits(guess.terms, normal) })
      if (intent === 'ask') return emit({ kind: 'done' })

      // history: by meaning when the index can answer, and by words
      const entries = this.d.history.all()
      const counts = new Map<string, { visits: number; last: number }>()
      for (const e of entries) {
        const k = hitKey(e.url)
        const c = counts.get(k)
        if (c) {
          c.visits++
          c.last = Math.max(c.last, e.time)
        } else counts.set(k, { visits: 1, last: e.time })
      }
      let hist: Hit[] = historyHits(guess.terms, entries)
      if (this.d.router.decide('embed', NORMAL) !== 'deny' && this.d.index.size > 0) {
        const open = new Set(normal.map((t) => t.url))
        const found = await Promise.race([
          this.d.index.search(req.query, SEMANTIC_MAX, SEMANTIC_MIN, open, SEMANTIC_MS),
          new Promise<null>((r) => setTimeout(() => r(null), SEMANTIC_MS + 200))
        ])
        hist = mergeHits(
          hist,
          (found ?? []).map((h) => {
            const c = counts.get(hitKey(h.url))
            return {
              url: h.url,
              title: h.title,
              source: 'history' as const,
              relevance: Math.min(1, h.score * 1.4),
              visits: c?.visits,
              lastVisit: c?.last
            }
          })
        )
      }
      const openKeys = new Set(normal.map((t) => hitKey(t.url)))
      emit({
        kind: 'hits',
        source: 'history',
        hits: hist.filter((h) => !openKeys.has(hitKey(h.url)))
      })

      emit({
        kind: 'hits',
        source: 'download',
        hits: downloadHits(
          guess.terms,
          this.d.downloads.list().filter((x) => x.state === 'completed')
        )
      })

      // the web, last: a hidden page in the normal session reads the engine's results
      const engine = SEARCH_ENGINES[this.d.settings.get().searchEngine] ?? SEARCH_ENGINES.duckduckgo
      const url = engine.url + encodeURIComponent(webQuery(guess))
      const raw = await this.d.content.hidden(url, (wc) => wc.executeJavaScript(SERP_SCRIPT))
      const web: Hit[] = (Array.isArray(raw) ? raw : []).slice(0, WEB_MAX).flatMap((r, i) => {
        const o = (r ?? {}) as Record<string, unknown>
        const u = str(o.url, 1000)
        if (!/^https?:\/\//i.test(u)) return []
        return [
          {
            url: u,
            title: str(o.title, 180),
            snippet: str(o.snippet, 240),
            source: 'web' as const,
            relevance: Math.max(0.3, 0.95 - i * 0.05)
          }
        ]
      })
      emit({ kind: 'hits', source: 'web', hits: web })
      emit({ kind: 'done' })
    } catch (err) {
      console.warn('[canvas] find:', err instanceof Error ? err.message : err)
      emit({ kind: 'error', message: 'The search could not finish.' })
    } finally {
      this.running.delete(req.queryId)
    }
  }
}
