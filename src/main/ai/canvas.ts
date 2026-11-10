import { createHash, randomBytes } from 'crypto'
import { ipcMain, nativeImage, type BrowserWindow } from 'electron'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import {
  assignByCentroid,
  CANVAS_THRESHOLD,
  clusterable,
  forDisk,
  hostClusters,
  liftSections,
  type CanvasState,
  type Group,
  type TabLite
} from '@shared/ai/canvas'
import { fallbackName, planGroups, sanitizeGroupName } from '@shared/ai/grouping'
import type { AiContext } from '@shared/ai/types'
import { cleanTitle } from '@shared/ai/titles'
import { fallbackSummary, parsePlacement, type Placement } from '@shared/ai/canvasPlace'
import { normalizeUrl } from '@shared/ai/urls'
import type { DownloadManager } from '../downloads'
import type { HistoryStore } from '../history'
import type { SettingsStore } from '../settings'
import { JsonStore } from '../store'
import type { TabManager } from '../tabs'
import { canvasBridge } from './canvasAssistant'
import { CanvasContent } from './canvasContent'
import { registerCanvasExport } from './canvasExport'
import { CanvasFinder } from './canvasFind'
import { GROUP_SYSTEM } from './features'
import type { EmbeddingIndex } from './index'
import type { AiRouter } from './router'
import { aiRoot } from './runtime'

const NORMAL: AiContext = { private: false, tor: false }
const THUMB_STALE_MS = 2 * 60_000
const THUMB_WIDTH = 480
const THUMB_FILES_MAX = 400
const THUMB_BYTES_MAX = 50 * 1024 * 1024

interface Saved {
  spaces: Record<string, CanvasState>
}

const isState = (v: unknown): v is CanvasState => {
  const s = v as Partial<CanvasState> | null
  return (
    !!s &&
    s.v === 1 &&
    Array.isArray(s.frames) &&
    Array.isArray(s.cards) &&
    Array.isArray(s.notes) &&
    s.frames.length < 2000 &&
    s.cards.length < 5000 &&
    s.notes.length < 2000
  )
}

/**
 * Canvas mode in main: the saved boards, the thumbnails the cards show, and the AI parts (clustering the open tabs,
 * naming a cluster, finding the frame a new tab belongs to). The layout itself is pure code in shared/ai/canvas.ts
 * and runs in the renderer. Private and Tor tabs are dropped here before anything reaches the index or a model:
 * they are never read, captured, cached or saved.
 */
export class CanvasService {
  private store = new JsonStore<Saved>('ai-canvas', { spaces: {} })
  /** Tab ids restart with the app, so a saved board says which run it belongs to. */
  readonly boot = randomBytes(6).toString('hex')

  constructor(private deps: { tabs: TabManager; index: EmbeddingIndex; router: AiRouter }) {}

  private get thumbDir(): string {
    return join(aiRoot(), 'thumbs')
  }

  private thumbFile(url: string): string | null {
    const key = normalizeUrl(url)
    if (!key) return null
    return join(this.thumbDir, createHash('sha1').update(key).digest('hex').slice(0, 24) + '.jpg')
  }

  load(spaceId: number): { state: CanvasState | null; boot: string } {
    const s = this.store.value.spaces[String(spaceId)]
    return { state: isState(s) ? liftSections(s) : null, boot: this.boot }
  }

  save(spaceId: number, state: unknown): void {
    if (!isState(state)) return
    // stamped here, so the new tab can show the boards most recently used first
    this.store.value.spaces[String(spaceId)] = { ...forDisk(state), usedAt: Date.now() }
    this.store.save()
  }

  /** Normal tabs of a space; private and Tor tabs are never in this list. */
  private normalTabs(spaceId: number): Array<TabLite & { title: string }> {
    return this.deps.tabs
      .canvasTabs(spaceId)
      .filter((t) => !t.private && !t.tor)
      .map((t) => ({ id: t.id, url: t.url, title: t.title, private: false }))
  }

  // ---- thumbnails ----

  /** The board is opening: bring in pictures from disk, take fresh ones of loaded tabs whose picture is old. */
  async refreshThumbs(spaceId: number): Promise<void> {
    const { tabs } = this.deps
    const now = Date.now()
    const list = tabs.canvasTabs(spaceId).filter((t) => !t.private && !t.tor)
    for (const t of list) {
      if (t.hasThumb) continue
      const file = this.thumbFile(t.url)
      if (!file || !existsSync(file)) continue
      try {
        tabs.seedThumb(t.id, 'data:image/jpeg;base64,' + readFileSync(file).toString('base64'))
      } catch {
        // an unreadable cache file is just no picture
      }
    }
    this.opened = { spaceId, at: now }
    await this.captureInView()
    this.cacheThumbs(spaceId)
  }

  /** The space whose board is open, and when it opened (pictures older than that are taken again in view). */
  private opened: { spaceId: number; at: number } | null = null
  private shown = new Set<number>()
  private capturing = false

  /** The cards on the open board's screen changed. */
  inView(spaceId: number, tabIds: number[]): void {
    if (!tabIds.length && this.opened?.spaceId === spaceId) this.opened = null
    this.shown = new Set(tabIds)
    void this.captureInView()
  }

  /**
   * Fresh pictures for old ones, of the cards on screen only, one at a time (each is a GPU read-back of a page made
   * to paint off-screen): on an older laptop a board of 200 tabs would otherwise read back 200 pages as it opens.
   * Cards scrolled to later get theirs then.
   */
  private async captureInView(): Promise<void> {
    if (this.capturing) return
    this.capturing = true
    try {
      for (;;) {
        const o = this.opened
        if (!o) return
        const next = this.deps.tabs
          .canvasTabs(o.spaceId)
          .find(
            (t) =>
              this.shown.has(t.id) &&
              !t.private &&
              !t.tor &&
              !t.unloaded &&
              /^https?:/i.test(t.url) &&
              o.at - t.thumbAt > THUMB_STALE_MS
          )
        if (!next) return
        const before = next.thumbAt
        await this.deps.tabs.captureHidden(next.id)
        // a page that cannot be pictured is not tried again until the board opens again
        if (this.deps.tabs.canvasTabs(o.spaceId).find((t) => t.id === next.id)?.thumbAt === before)
          this.shown.delete(next.id)
      }
    } finally {
      this.capturing = false
    }
  }

  /** Write the pictures of normal tabs to the cache folder (small ones), so a restart still has them. */
  cacheThumbs(spaceId: number): void {
    try {
      mkdirSync(this.thumbDir, { recursive: true })
      for (const t of this.deps.tabs.canvasTabs(spaceId)) {
        if (t.private || t.tor || t.thumbAt === 0) continue
        const file = this.thumbFile(t.url)
        const data = this.deps.tabs.thumbOf(t.id)
        if (!file || !data) continue
        if (existsSync(file) && statSync(file).mtimeMs >= t.thumbAt) continue
        const image = nativeImage.createFromDataURL(data)
        writeFileSync(file, image.resize({ width: THUMB_WIDTH, quality: 'good' }).toJPEG(70))
      }
      const files = readdirSync(this.thumbDir).map((f) => {
        const s = statSync(join(this.thumbDir, f))
        return { f, at: s.mtimeMs, size: s.size }
      })
      // oldest go first, until there are few enough files and they are small enough together
      files.sort((a, b) => a.at - b.at)
      let bytes = files.reduce((n, x) => n + x.size, 0)
      let count = files.length
      for (const x of files) {
        if (count <= THUMB_FILES_MAX && bytes <= THUMB_BYTES_MAX) break
        unlinkSync(join(this.thumbDir, x.f))
        count--
        bytes -= x.size
      }
    } catch (err) {
      console.warn('[canvas] thumbnail cache:', err instanceof Error ? err.message : err)
    }
  }

  // ---- AI ----

  /** Whether pages can be compared by meaning right now (else the board groups by site). */
  private semantic(): boolean {
    return this.deps.router.decide('embed', NORMAL) !== 'deny' && this.deps.index.size > 0
  }

  /** Groups of the space's normal tabs: by meaning when the index has them, by site otherwise. */
  cluster(spaceId: number): { groups: Group[]; semantic: boolean } {
    const tabs = clusterable(this.normalTabs(spaceId))
    if (!this.semantic()) return { groups: hostClusters(tabs), semantic: false }
    const withVec: Array<{ id: number; url: string; title: string; vec: Float32Array }> = []
    const bare: TabLite[] = []
    for (const t of tabs) {
      const vec = this.deps.index.vectorOf(t.url)
      if (vec) withVec.push({ id: t.id, url: t.url, title: '', vec })
      else bare.push(t)
    }
    const groups: Group[] = planGroups(withVec, CANVAS_THRESHOLD).map((ids) => ({
      ids,
      name: fallbackName(withVec.filter((w) => ids.includes(w.id)).map((w) => w.url))
    }))
    // pages the index has not read yet: at least tabs of one site stay together
    return { groups: [...groups, ...hostClusters(bare)], semantic: true }
  }

  /** A name for a cluster from the model (2 or 3 words), or null. */
  async name(spaceId: number, ids: number[]): Promise<string | null> {
    const own = new Map(this.normalTabs(spaceId).map((t) => [t.id, t]))
    const titles = ids
      .flatMap((id) =>
        own.has(id) ? [cleanTitle(own.get(id)!.title, own.get(id)!.url).title.slice(0, 100)] : []
      )
      .filter((t) => t.trim() !== '')
      .slice(0, 12)
    if (titles.length < 2) return null
    const raw = await this.deps.router.generate({
      task: 'group-name',
      ctx: NORMAL,
      system: GROUP_SYSTEM,
      prompt: titles.map((t) => `- ${t}`).join('\n'),
      field: 'name'
    })
    // a model likes to trail off with a dash or a colon
    const name = raw ? sanitizeGroupName(raw.replace(/[\s\-–—:,;]+$/, '')) : null
    const trimmed = name ? name.replace(/(\s+(and|or|of|the|with|for|in|on|to|a|&))+$/i, '') : ''
    return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : null
  }

  /** Key points of a page, as Markdown bullets; null when no model may or can answer. */
  async summarize(title: string, text: string): Promise<string | null> {
    const raw = await this.deps.router.generate({
      task: 'chat',
      ctx: NORMAL,
      system:
        'You summarise a web page for a note. Answer with JSON: {"summary": "..."}. The summary is 3 to 5 short Markdown bullets ("- ...") with the key points, in the language of the page.',
      prompt: `Title: ${title}\n\n${text}`,
      field: 'summary'
    })
    const t = raw?.trim()
    return t ? t.slice(0, 1200) : null
  }

  /** A model's call on a page the rules could not place; null when it cannot say. */
  async placement(url: string, title: string, text: string): Promise<Placement | null> {
    const raw = await this.deps.router.generate({
      task: 'chat',
      ctx: NORMAL,
      system:
        'Decide how a web page should sit on a canvas. Answer with JSON: {"placement": "document"} for an article or reference to read, {"placement": "live"} for an app or tool that needs interaction (mail, editor, dashboard), {"placement": "note"} for a short fact or answer.',
      prompt: `${url}\n${title}\n${text}`,
      field: 'placement'
    })
    return parsePlacement(raw)
  }

  /** The frame (of those given, by their tab ids) a tab is closest to in meaning, or null: it goes to Other. */
  assign(spaceId: number, tabId: number, frames: Record<string, number[]>): string | null {
    if (!this.semantic()) return null
    const own = new Map(this.normalTabs(spaceId).map((t) => [t.id, t]))
    const t = own.get(tabId)
    const vec = t && this.deps.index.vectorOf(t.url)
    if (!vec) return null
    const list = Object.entries(frames).map(([id, ids]) => ({
      id,
      vectors: ids.flatMap((i) => {
        const m = own.get(i)
        const v = m && i !== tabId ? this.deps.index.vectorOf(m.url) : undefined
        return v ? [v] : []
      })
    }))
    return assignByCentroid(vec, list)
  }
}

export function registerCanvas(d: {
  win: BrowserWindow
  tabs: TabManager
  index: EmbeddingIndex
  router: AiRouter
  history: HistoryStore
  downloads: DownloadManager
  settings: SettingsStore
  content: CanvasContent
}): CanvasService {
  const svc = new CanvasService(d)
  canvasBridge.win = d.win
  canvasBridge.allowed = () => d.tabs.activeKind() === 'normal'
  registerCanvasExport(d.win, () => d.tabs.activeKind() === 'normal')
  const mine = (e: { sender: unknown }): boolean => e.sender === d.win.webContents
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : -1)
  const ids = (v: unknown): number[] =>
    Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []
  ipcMain.handle('canvas:load', (e, spaceId: unknown) => (mine(e) ? svc.load(num(spaceId)) : null))
  ipcMain.on('canvas:save', (e, spaceId: unknown, state: unknown) => {
    if (mine(e)) svc.save(num(spaceId), state)
  })
  ipcMain.on('canvas:open', (e, spaceId: unknown) => {
    if (!mine(e)) return
    d.tabs.setCanvasMode(true)
    // after the board's entrance: captures are GPU read-backs and would cost it frames
    setTimeout(() => void svc.refreshThumbs(num(spaceId)), 700)
  })
  ipcMain.on('canvas:in-view', (e, spaceId: unknown, list: unknown) => {
    if (mine(e)) svc.inView(num(spaceId), ids(list).slice(0, 2000))
  })
  // Live tab streams on cards: only the board's own page may ask, and the stream id is bound to it.
  ipcMain.on('canvas:streaming', (e, list: unknown) => {
    if (mine(e)) d.tabs.setStreaming(ids(list).slice(0, 8))
  })
  ipcMain.handle('canvas:stream-source', (e, tabId: unknown) =>
    mine(e) ? d.tabs.streamSource(num(tabId)) : null
  )
  ipcMain.handle('canvas:video-region', (e, tabId: unknown) =>
    mine(e) ? d.tabs.videoRegion(num(tabId)) : null
  )
  ipcMain.on('canvas:close', (e, spaceId: unknown) => {
    if (!mine(e)) return
    svc.inView(num(spaceId), [])
    d.tabs.setCanvasMode(false)
    svc.cacheThumbs(num(spaceId))
  })
  ipcMain.handle('canvas:cluster', (e, spaceId: unknown) =>
    mine(e) ? svc.cluster(num(spaceId)) : { groups: [], semantic: false }
  )
  ipcMain.handle('canvas:name', (e, spaceId: unknown, list: unknown) =>
    mine(e) ? svc.name(num(spaceId), ids(list)) : null
  )
  ipcMain.handle('canvas:assign', (e, spaceId: unknown, tabId: unknown, frames: unknown) => {
    if (!mine(e) || !frames || typeof frames !== 'object') return null
    const clean: Record<string, number[]> = {}
    for (const [k, v] of Object.entries(frames)) clean[k] = ids(v)
    return svc.assign(num(spaceId), num(tabId), clean)
  })
  // ---- v2: content, search, the one live page ----
  const content = d.content
  const finder = new CanvasFinder({ ...d, content })
  const rectOf = (v: unknown): { x: number; y: number; width: number; height: number } | null => {
    const r = v as Record<string, unknown> | null
    if (!r || typeof r !== 'object') return null
    const n = (k: string): number =>
      typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : NaN
    const out = {
      x: Math.round(n('x')),
      y: Math.round(n('y')),
      width: Math.round(n('width')),
      height: Math.round(n('height'))
    }
    return Object.values(out).every((x) => Number.isFinite(x)) && out.width > 40 && out.height > 40
      ? out
      : null
  }
  ipcMain.handle('canvas:content', (e, tabId: unknown) =>
    mine(e) ? content.card(num(tabId)) : null
  )
  ipcMain.handle('canvas:reader', (e, req: unknown) => {
    const r = (req ?? {}) as { tab?: unknown; url?: unknown }
    return mine(e)
      ? content.reader({
          tab: typeof r.tab === 'number' ? r.tab : undefined,
          url: typeof r.url === 'string' ? r.url : undefined
        })
      : null
  })
  // a file dropped or pasted onto the board: kept as a copy, never for a private or Tor window
  ipcMain.handle('canvas:store', (e, req: unknown) => {
    const r = (req ?? {}) as { path?: unknown; name?: unknown; data?: unknown }
    if (!mine(e) || d.tabs.activeKind() !== 'normal') return null
    return d.content.store({
      path: typeof r.path === 'string' ? r.path : undefined,
      name: typeof r.name === 'string' ? r.name : undefined,
      data: r.data instanceof Uint8Array ? r.data : undefined
    })
  })
  ipcMain.handle('canvas:bytes', (e, req: unknown) => {
    const r = (req ?? {}) as { url?: unknown; file?: unknown }
    return mine(e)
      ? content.bytes({
          url: typeof r.url === 'string' ? r.url : undefined,
          file: typeof r.file === 'string' ? r.file : undefined
        })
      : null
  })
  ipcMain.on(
    'canvas:find',
    (e, queryId: unknown, query: unknown, spaceId: unknown, classify: unknown) => {
      if (!mine(e) || typeof queryId !== 'string' || typeof query !== 'string') return
      void finder.run(d.win, {
        queryId: queryId.slice(0, 60),
        query: query.slice(0, 300),
        spaceId: num(spaceId),
        classify: classify === true
      })
    }
  )
  ipcMain.on('canvas:find-cancel', (e, queryId: unknown) => {
    if (mine(e) && typeof queryId === 'string') finder.cancel(queryId)
  })
  // Bumped by every open and hide: an open still waiting for its page shows it only if nothing came after it.
  let liveGen = 0
  // The one live page: made if it is a new address, waited for until it has loaded, then shown exactly at the rect.
  ipcMain.handle('canvas:live-open', async (e, req: unknown) => {
    const r = (req ?? {}) as { tab?: unknown; url?: unknown; rect?: unknown }
    const rect = rectOf(r.rect)
    if (!mine(e) || !rect) return null
    let id = typeof r.tab === 'number' ? r.tab : null
    if (id === null && typeof r.url === 'string' && /^https?:\/\//i.test(r.url)) {
      id = d.tabs.create(r.url, false)
    }
    if (id === null) return null
    const gen = ++liveGen
    d.tabs.setLive(null)
    d.tabs.prepareLive(id, rect) // an unloaded tab starts loading now, not after the wait below
    const until = Date.now() + 7000
    while (!d.tabs.liveReady(id) && Date.now() < until && gen === liveGen)
      await new Promise((x) => setTimeout(x, 80))
    // closed (or another page asked for) while this one loaded: showing it now would leave a page over the board
    if (gen === liveGen) d.tabs.setLive(id, rect)
    return id
  })
  // The preview's address field: load it in the card's tab, or (a page found on the web) in a new background tab.
  ipcMain.handle('canvas:navigate', (e, tab: unknown, input: unknown) => {
    if (!mine(e) || typeof input !== 'string' || !input.trim()) return null
    const text = input.trim().slice(0, 4000)
    if (typeof tab === 'number') return d.tabs.navigateTab(tab, text) ? tab : null
    return d.tabs.create(text, false)
  })
  ipcMain.on('canvas:live-move', (e, id: unknown, rect: unknown) => {
    const r = rectOf(rect)
    if (mine(e) && typeof id === 'number' && r) d.tabs.setLive(id, r)
  })
  ipcMain.on('canvas:live-nav', (e, id: unknown, what: unknown) => {
    if (
      mine(e) &&
      typeof id === 'number' &&
      (what === 'back' || what === 'forward' || what === 'reload' || what === 'stop')
    )
      d.tabs.navTab(id, what)
  })
  ipcMain.on('canvas:live-hide', (e) => {
    if (!mine(e)) return
    liveGen++
    d.tabs.setLive(null)
  })
  ipcMain.on('canvas:preview', (e, open: unknown, tab: unknown) => {
    if (mine(e)) d.tabs.setPreview(open === true, typeof tab === 'number' ? tab : null)
  })
  ipcMain.handle('canvas:live-shot', async (e, tabId: unknown) => {
    const wc = mine(e) && typeof tabId === 'number' ? d.tabs.contentsOf(tabId) : null
    const page = typeof tabId === 'number' ? d.tabs.pageFor(tabId) : null
    // never a picture of a private or Tor page, whichever tab is active
    if (!wc || d.tabs.activeKind() !== 'normal' || !page || page.private || page.tor) return null
    try {
      const img = await wc.capturePage()
      return img.isEmpty() ? null : 'data:image/jpeg;base64,' + img.toJPEG(82).toString('base64')
    } catch {
      return null
    }
  })
  // A page as a note: key points from the model, or its first sentences when no model can say. Refused for private
  // and Tor (the reader never reads them, and nothing is asked of a model in such a window).
  ipcMain.handle('canvas:summarize', async (e, req: unknown) => {
    const r = (req ?? {}) as { tab?: unknown; url?: unknown }
    if (!mine(e) || d.tabs.activeKind() !== 'normal') return null
    const doc = await content.reader({
      tab: typeof r.tab === 'number' ? r.tab : undefined,
      url: typeof r.url === 'string' ? r.url : undefined
    })
    if (!doc) return null
    const text = doc.blocks
      .filter((b) => b.t !== 'img')
      .map((b) => (b as { text: string }).text)
      .join('\n')
      .slice(0, 6000)
    if (!text) return null
    const raw = await svc.summarize(doc.title, text)
    return raw ?? fallbackSummary(text)
  })
  ipcMain.handle('canvas:placement', async (e, req: unknown) => {
    const r = (req ?? {}) as { url?: unknown; title?: unknown; text?: unknown }
    if (!mine(e) || d.tabs.activeKind() !== 'normal' || typeof r.url !== 'string') return null
    return svc.placement(
      r.url.slice(0, 300),
      String(r.title ?? '').slice(0, 160),
      String(r.text ?? '').slice(0, 500)
    )
  })
  ipcMain.on('canvas:reopen', (e, n: unknown) => {
    if (!mine(e)) return
    for (let i = 0; i < Math.min(50, num(n)); i++) d.tabs.reopenClosed()
  })
  return svc
}
