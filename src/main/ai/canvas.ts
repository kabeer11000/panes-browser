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
import {
  cleanGroupName,
  fallbackName,
  groupNamesPrompt,
  NAMES_PER_CALL,
  parseGroupNames,
  planGroups
} from '@shared/ai/grouping'
import type { AiContext } from '@shared/ai/types'
import { cleanTitle } from '@shared/ai/titles'
import { fallbackSummary } from '@shared/ai/canvasPlace'
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
import { GROUP_SYSTEM, GROUPS_SYSTEM } from './features'
import type { EmbeddingIndex } from './index'
import type { AiRouter } from './router'
import { aiRoot } from './runtime'

const NORMAL: AiContext = { private: false, tor: false }
const THUMB_STALE_MS = 2 * 60_000
/** Pictures kept on disk are at most this wide: sharp on a card zoomed in to about twice its size, and 400 of them
 * (about 90 KB each) stay well inside THUMB_BYTES_MAX. One taken smaller is kept as it is. */
const THUMB_WIDTH = 960
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
    this.saveQuiet(spaceId, state)
    // a shared space: what changed goes to the others (main/share.ts)
    this.onSave?.(spaceId, state)
  }

  /** Saved without telling the shared space (a board that came from it). */
  saveQuiet(spaceId: number, state: CanvasState): void {
    // stamped here, so the new tab can show the boards most recently used first
    this.store.value.spaces[String(spaceId)] = { ...forDisk(state), usedAt: Date.now() }
    this.store.save()
    this.onSaved?.()
  }

  /** Called with each board the window saves (main/share.ts sends what changed to a shared space's room). */
  onSave: ((spaceId: number, state: CanvasState) => void) | null = null

  /** Called after every board save (the widget alarms look again at what is due). */
  onSaved: (() => void) | null = null

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
        tabs.seedThumb(t.id, readFileSync(file))
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
        const image = nativeImage.createFromBuffer(data)
        const w = image.getSize().width
        const kept = w > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image
        writeFileSync(file, kept.toJPEG(72))
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

  /**
   * Names for clusters from the model (2 or 3 words each, null where it had none), NAMES_PER_CALL clusters to a
   * call: one call for a whole tidy, not one per section (each call reads a prompt, which is most of its cost).
   */
  async names(spaceId: number, clusters: number[][]): Promise<(string | null)[]> {
    const own = new Map(this.normalTabs(spaceId).map((t) => [t.id, t]))
    const titlesOf = (ids: number[]): string[] =>
      ids
        .flatMap((id) =>
          own.has(id) ? [cleanTitle(own.get(id)!.title, own.get(id)!.url).title.slice(0, 80)] : []
        )
        .filter((t) => t.trim() !== '')
        .slice(0, 6)
    const out: (string | null)[] = clusters.map(() => null)
    // a cluster with fewer than two titles has nothing for the model to find in common
    const asked = clusters
      .map((ids, i) => ({ i, titles: titlesOf(ids) }))
      .filter((c) => c.titles.length >= 2)
    for (let at = 0; at < asked.length; at += NAMES_PER_CALL) {
      const part = asked.slice(at, at + NAMES_PER_CALL)
      const raw = await this.deps.router.generate({
        task: 'group-name',
        ctx: NORMAL,
        system: part.length === 1 ? GROUP_SYSTEM : GROUPS_SYSTEM,
        prompt:
          part.length === 1
            ? part[0].titles.map((t) => `- ${t}`).join('\n')
            : groupNamesPrompt(part.map((c) => c.titles)),
        field: part.length === 1 ? 'name' : 'names'
      })
      const got = part.length === 1 ? [cleanGroupName(raw)] : parseGroupNames(raw, part.length)
      part.forEach((c, k) => (out[c.i] = got[k]))
    }
    return out
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
  canvasBridge.allowed = () => d.tabs.boardKind() === 'normal'
  registerCanvasExport(d.win, () => d.tabs.boardKind() === 'normal', d.downloads, d.settings)
  const mine = (e: { sender: unknown }): boolean => e.sender === d.win.webContents
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : -1)
  const ids = (v: unknown): number[] =>
    Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []
  ipcMain.handle('canvas:load', (e, spaceId: unknown) => (mine(e) ? svc.load(num(spaceId)) : null))
  ipcMain.on('canvas:save', (e, spaceId: unknown, state: unknown) => {
    if (mine(e)) svc.save(num(spaceId), state)
  })
  // Boards up. On a space switch the new board can open before the old one has closed (its exit still
  // running): canvas mode follows whether any board is up, so the old board's late close does not end the new one's.
  let boards = 0
  // the interface reloaded (or crashed) with a board up: that board never says it closed
  d.win.webContents.on('did-start-loading', () => {
    if (boards === 0) return // none up (or the first load, which may come back to the board)
    boards = 0
    d.tabs.setCanvasMode(false)
  })
  // a session restored onto the board that never shows one (it is turned off, say): back to the tabs, a while after
  // the interface has loaded (counting from start would give up while a slow first load is still going)
  d.win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (boards === 0 && d.tabs.inCanvas()) d.tabs.setCanvasMode(false)
    }, 8000).unref()
  })
  ipcMain.on('canvas:open', (e, spaceId: unknown) => {
    if (!mine(e)) return
    boards++
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
  // cards zoomed in on, larger on screen than their pictures: sharper ones, at about their width (64 to 3840 px)
  ipcMain.on('canvas:sharpen', (e, list: unknown) => {
    if (!mine(e) || !Array.isArray(list)) return
    const want = list
      .slice(0, 8)
      .filter(
        (x): x is { id: number; width: number } =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as { id?: unknown }).id === 'number' &&
          typeof (x as { width?: unknown }).width === 'number' &&
          Number.isFinite((x as { width: number }).width)
      )
      .map((x) => ({ id: x.id, width: Math.max(64, Math.min(3840, x.width)) }))
    if (want.length) d.tabs.sharpen(want)
  })
  ipcMain.handle('canvas:video-region', (e, tabId: unknown) =>
    mine(e) ? d.tabs.videoRegion(num(tabId)) : null
  )
  ipcMain.on('canvas:close', (e, spaceId: unknown) => {
    if (!mine(e)) return
    svc.inView(num(spaceId), [])
    boards = Math.max(0, boards - 1)
    // a board closing and another (or the same, remounted) opening at once is not leaving the board: wait a moment
    // before the tab view comes back, or its tab would load for nothing
    if (boards === 0)
      setTimeout(() => {
        if (boards === 0) d.tabs.setCanvasMode(false)
      }, 150)
    svc.cacheThumbs(num(spaceId))
  })
  ipcMain.handle('canvas:cluster', (e, spaceId: unknown) =>
    mine(e) ? svc.cluster(num(spaceId)) : { groups: [], semantic: false }
  )
  ipcMain.handle('canvas:names', (e, spaceId: unknown, list: unknown) =>
    mine(e) && Array.isArray(list) ? svc.names(num(spaceId), list.slice(0, 200).map(ids)) : []
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
    if (!mine(e) || d.tabs.boardKind() !== 'normal') return null
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
  // The one live page: made if it is a new address, readied out of sight at the rect's size (painting there, so its
  // first frame on screen is a finished one), then shown exactly at the rect, or (`defer`) left for the preview to
  // show with live-move once its panel is at rest. A page already live stays on screen meanwhile (a swap in place:
  // never an empty slot), for `hold` ms at most if the new one is slow; then its picture stands in.
  ipcMain.handle('canvas:live-open', async (e, req: unknown) => {
    const r = (req ?? {}) as {
      tab?: unknown
      url?: unknown
      rect?: unknown
      defer?: unknown
      hold?: unknown
    }
    const rect = rectOf(r.rect)
    if (!mine(e) || !rect) return null
    let id = typeof r.tab === 'number' ? r.tab : null
    if (id === null && typeof r.url === 'string' && /^https?:\/\//i.test(r.url)) {
      id = d.tabs.create(r.url, false)
    }
    if (id === null) return null
    const gen = ++liveGen
    const hold = typeof r.hold === 'number' ? Math.max(0, Math.min(3000, r.hold)) : 0
    const other = d.tabs.liveTab()
    let holdTimer: NodeJS.Timeout | undefined
    if (other !== null && other !== id) {
      if (hold > 0)
        holdTimer = setTimeout(() => {
          if (gen !== liveGen || d.tabs.liveTab() !== other) return
          d.tabs.setLive(null)
          watchLive(null)
          keepAsThumb(other)
          d.tabs.prepareLive(id, rect)
        }, hold)
      else {
        d.tabs.setLive(null)
        watchLive(null)
        keepAsThumb(other)
      }
    }
    d.tabs.prepareLive(id, rect) // an unloaded tab starts loading now, and paints out of sight at the slot's size
    // shown as Chrome shows a page: from its first paint, the rest loading in view (not behind the picture until the
    // whole page has loaded, unclickable for seconds)
    const until = Date.now() + 7000
    // shown the frame it is ready, not up to 80 ms later
    const poll = async (ready: () => boolean): Promise<void> => {
      while (!ready() && Date.now() < until && gen === liveGen)
        await new Promise((x) => setTimeout(x, 16))
    }
    await poll(() => d.tabs.liveCommitted(id))
    // never later than the page's load, as before: a page that cannot paint yet (frozen, hidden) does not hold it
    if (gen === liveGen)
      await Promise.race([d.tabs.painted(id, until - Date.now()), poll(() => d.tabs.liveReady(id))])
    clearTimeout(holdTimer)
    // closed (or another page asked for) while this one loaded: showing it now would leave a page over the board
    if (gen !== liveGen) return id
    if (r.defer !== true) {
      d.tabs.setLive(id, rect)
      watchLive(id)
    }
    return id
  })
  // The preview is opening onto this tab: it loads (or wakes) now, while the panel grows, not after
  ipcMain.on('canvas:live-prepare', (e, id: unknown) => {
    if (mine(e) && typeof id === 'number') d.tabs.prepareLive(id)
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
    if (mine(e) && typeof id === 'number' && r) {
      const was = d.tabs.liveTab()
      d.tabs.setLive(id, r)
      if (was !== null && was !== id) keepAsThumb(was)
      watchLive(id)
    }
  })
  ipcMain.on('canvas:live-nav', (e, id: unknown, what: unknown) => {
    if (
      mine(e) &&
      typeof id === 'number' &&
      (what === 'back' || what === 'forward' || what === 'reload' || what === 'stop')
    )
      d.tabs.navTab(id, what)
  })
  ipcMain.on('canvas:live-aside', (e, on: unknown) => {
    if (mine(e)) d.tabs.setLiveAside(on === true)
  })
  ipcMain.on('canvas:live-hide', (e) => {
    if (!mine(e)) return
    liveGen++
    const was = d.tabs.liveTab()
    d.tabs.setLive(null)
    watchLive(null)
    keepAsThumb(was)
    d.tabs.setCompanions([])
  })
  // the other panes of a split shown in the preview, beside the live page
  ipcMain.on('canvas:live-companions', (e, list: unknown) => {
    if (!mine(e) || !Array.isArray(list)) return
    const clean: Array<{
      id: number
      rect: { x: number; y: number; width: number; height: number }
    }> = []
    for (const it of list.slice(0, 4)) {
      const r = it as { id?: unknown; rect?: unknown } | null
      const rect = rectOf(r?.rect)
      if (r && typeof r.id === 'number' && rect) clean.push({ id: r.id, rect })
    }
    d.tabs.setCompanions(clean)
  })
  ipcMain.on('canvas:preview', (e, open: unknown, tab: unknown) => {
    if (mine(e)) d.tabs.setPreview(open === true, typeof tab === 'number' ? tab : null)
  })
  // The live page's latest picture, taken while the preview is open (see live-shot). It becomes the card's picture
  // once the preview has let the page go, after the flight back: the board drawing again mid-flight would cost frames.
  let kept: { id: number; img: Electron.NativeImage; at: number } | null = null
  const keepAsThumb = (id: number | null): void => {
    const k = kept
    if (!k || k.id !== id) return
    kept = null
    setTimeout(() => {
      const small = k.img.getSize().width > 960 ? k.img.resize({ width: 960 }) : k.img
      d.tabs.takeThumb(k.id, small.toJPEG(80), k.at)
    }, 450)
  }
  const capture = async (tabId: number): Promise<Electron.NativeImage | null> => {
    const wc = d.tabs.contentsOf(tabId)
    const page = d.tabs.pageFor(tabId)
    // never a picture of a private or Tor page, whichever tab is active
    if (!wc || d.tabs.boardKind() !== 'normal' || !page || page.private || page.tor) return null
    try {
      const img = await wc.capturePage()
      return img.isEmpty() ? null : img
    } catch {
      return null
    }
  }
  // `thumb`: the picture is also its card's from now on; false for the pictures kept ready while it is open (the
  // card gets the last of those once the preview closes, see keepAsThumb)
  ipcMain.handle('canvas:live-shot', async (e, tabId: unknown, thumb: unknown) => {
    if (!mine(e) || typeof tabId !== 'number') return null
    const img = await capture(tabId)
    if (!img) return null
    if (thumb !== false) {
      const small = img.getSize().width > 960 ? img.resize({ width: 960 }) : img
      d.tabs.takeThumb(tabId, small.toJPEG(80))
    } else kept = { id: tabId, img, at: Date.now() }
    return 'data:image/jpeg;base64,' + img.toJPEG(82).toString('base64')
  })
  // The live page used (scrolled, typed in, clicked) or loaded: a fresh picture once it has been still a moment,
  // pushed to the preview, so closing it shows the page as it is, without waiting for a capture.
  /** The page still this long after it was used before its picture is taken; the picture at most this wide. */
  const PIC_QUIET_MS = 700
  const PIC_MAX_W = 1600
  let watched: { id: number; wc: Electron.WebContents; off: () => void } | null = null
  const watchLive = (id: number | null): void => {
    if (watched?.id === id) return
    watched?.off()
    watched = null
    const wc = id !== null ? d.tabs.contentsOf(id) : null
    if (id === null || !wc) return
    let timer: NodeJS.Timeout | undefined
    const soon = (): void => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        if (d.tabs.liveTab() !== id) return
        const full = await capture(id)
        if (!full || d.tabs.liveTab() !== id || d.win.isDestroyed()) return
        // no wider than the preview ever shows it: a full-size picture of a large window took ~16 ms of main to encode
        const img = full.getSize().width > PIC_MAX_W ? full.resize({ width: PIC_MAX_W }) : full
        kept = { id, img, at: Date.now() }
        d.win.webContents.send(
          'canvas:live-pic',
          id,
          'data:image/jpeg;base64,' + img.toJPEG(82).toString('base64')
        )
      }, PIC_QUIET_MS)
    }
    const onInput = (_e: unknown, i: { type: string }): void => {
      if (!/^mouse(Move|Enter|Leave)$/.test(i.type)) soon()
    }
    wc.on('input-event', onInput)
    wc.on('did-stop-loading', soon)
    wc.on('did-navigate-in-page', soon)
    watched = {
      id,
      wc,
      off: () => {
        clearTimeout(timer)
        if (wc.isDestroyed()) return
        wc.off('input-event', onInput)
        wc.off('did-stop-loading', soon)
        wc.off('did-navigate-in-page', soon)
      }
    }
  }
  // A page as a note: key points from the model, or its first sentences when no model can say. Refused for private
  // and Tor (the reader never reads them, and nothing is asked of a model in such a window).
  ipcMain.handle('canvas:summarize', async (e, req: unknown) => {
    const r = (req ?? {}) as { tab?: unknown; url?: unknown }
    const asked = typeof r.tab === 'number' ? d.tabs.pageFor(r.tab) : null
    if (!mine(e) || d.tabs.boardKind() !== 'normal' || asked?.private || asked?.tor) return null
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
  ipcMain.on('canvas:reopen', (e, n: unknown) => {
    if (!mine(e)) return
    for (let i = 0; i < Math.min(50, num(n)); i++) d.tabs.reopenClosed()
  })
  return svc
}
