import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  shell,
  WebContentsView,
  type Event,
  type Input,
  type MenuItemConstructorOptions,
  type MouseWheelInputEvent,
  type Session,
  type WebContents
} from 'electron'
import { writeFileSync } from 'fs'
import { pathToFileURL } from 'url'
import {
  GROUP_COLORS,
  GROUP_COLOR_NAMES,
  groupAfterMove,
  nextGroupColor,
  placeInGroup,
  sanitizeGroupPatch,
  type TabGroup
} from '../shared/tabgroups'
import { stageBackground } from '../shared/color'
import { siteListed, ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN } from '../shared/memory'
import { siteKey, siteThemeCss } from '../shared/sitetheme'
import { CAPTURE_SCRIPT, NO_CAPTURE, parseCapture, type CaptureState } from '../shared/capture'
import { dumpableTabs, type TabDump } from '../shared/dumps'
import type { DumpStore } from './dumps'
import type { TorManager } from './tor'
import { ZAP_PREFIX, ZAP_SCRIPT } from '../shared/zap'
import { errorPageUrl } from '../shared/errors'
import { FullscreenNotice } from './fullscreenNotice'
import { totalmem } from 'os'
import { applyChromeIdentity } from './identity'
import { PdfViewerHelper } from './pdf'
import { runningMode } from './performance'
import { pickUnloads, type MemoryPolicy, type TabFacts } from '../shared/memory'
import { join } from 'path'
import { internalUrl, type InternalPage } from '../shared/settings'
import {
  applyDrop,
  insertTab,
  leaf,
  leaves,
  normalizeLayout,
  removeTab,
  ROOT_TARGET,
  setRatios,
  type Edge,
  type LayoutNode
} from '../shared/layout'
import type {
  InitialData,
  MemoryStats,
  Rect,
  SpacePatch,
  TabInfo,
  TabsState,
  UiCommand
} from '../shared/types'
import { resolveInput } from '../shared/url'
import { showContextMenu } from './contextMenu'
import { PipController } from './pip'
import type { BookmarkStore, HistoryStore } from './history'
import type { SettingsStore } from './settings'
import type { SpaceStore } from './spaces'
import { JsonStore } from './store'

const THUMB_WIDTH = 800
const THUMB_INTERVAL_MS = 4000
const SNAPSHOT_TIMEOUT_MS = 250 // overlays open without waiting longer than this for snapshots
const THUMB_FRESH_MS = 2000 // a snapshot newer than this is good enough, so opening an overlay does not wait
const FIRST_PAINT_MS = 90 // after dom-ready, before a freshly loaded page is revealed
const AWAIT_PAINT_MAX_MS = 2500 // never keep a view hidden longer than this, whatever the page does
const VIEW_RADIUS = 12
const ZOOM_STEP = 0.5
const ZOOM_MIN = ZOOM_LEVEL_MIN
const ZOOM_MAX = ZOOM_LEVEL_MAX
const PARKED_X = -20000 // where views wait, out of sight, while an overlay is open
const MEMORY_SWEEP_MS = 30_000
const ESC_HOLD_MS = 1000
const STACK_STEP = 160 // one card of the tab stack, in the renderer's wheel units
const OPEN_EXTERNALLY = new Set(['mailto:', 'tel:'])

interface Tab {
  view: WebContentsView
  favicon: string | null
  thumb: string | null
  /** When `thumb` was captured (ms since epoch); 0 before the first capture. */
  thumbAt: number
  /** The picture was taken at (nearly) the page's own size, not shrunk for the overview. */
  thumbSharp: boolean
  /** The size of the page when the picture was taken: a picture of another shape would be stretched. */
  thumbSize: { w: number; h: number }
  thumbTimer: NodeJS.Timeout | null
  /** The page may look different from `thumb` (input, navigation, sound). Snapshots read the GPU back, so an unchanged page is not captured again. */
  dirty: boolean
  /** Created with a URL, so it is loading rather than blank even while getURL() is still empty. */
  hasUrl: boolean
  spaceId: number
  /** Restored or unloaded, not loaded yet: loads the first time the tab is shown. */
  pending: { url: string; title: string } | null
  /** No page of its own: `view` is the shared inert one. Loading builds a real view. */
  unloaded: boolean
  /** Last time the tab was on screen (ms since epoch), for the memory saver. */
  lastShownAt: number
  /** Sidebar group (not the tiled split group). Members of a group are always neighbours. */
  groupId: number | null
  /** Whether the page currently has Chromium's automatic dark mode forced on. */
  darkened: boolean
  /** Key of the style sheet a boost put into the page, so it can be taken out again. */
  /** A private tab: kept out of history, the saved session and saved sessions, in its own in-memory session. */
  private: boolean
  tor: boolean
  /** What the page reported it is capturing (see CAPTURE_SCRIPT). */
  capture: CaptureState
  boostKey: string | null
  /** A style-sheet swap is under way, and whether another edit arrived during it. */
  boosting: boolean
  boostAgain: boolean
  /** The page grabbed the keyboard (games, remote desktops), so Esc only leaves full screen when held. */
  keyLock: boolean
  /** Square corners (the page fills the screen), not the rounded ones of a page inside the window. */
  flat: boolean
  /** The load that failed, while the tab shows Panes' error page for it. */
  failed: { url: string; code: number; desc: string } | null
  /** A page loaded into a view that had shown nothing: the view stays hidden until it has painted. */
  awaiting: boolean
  /** Where the first load went, so the tab has an address while the page has not committed yet. */
  firstUrl: string
}

/** The tab's live WebContents, or null while it is being torn down (reading it then would throw). */
function liveContents(tab: Tab): WebContents | null {
  const wc = tab.view.webContents as WebContents | undefined
  return wc && !wc.isDestroyed() ? wc : null
}

export class TabManager {
  private tabs = new Map<number, Tab>() // insertion order is display order
  private activeId: number | null = null
  private nextId = 1
  private layout: LayoutNode | null = null
  private pip: PipController
  /** Spaces: the active one owns `activeId` and `layout`; the others keep theirs here while hidden. */
  private activeSpaceId = 0
  private layouts = new Map<number, LayoutNode | null>()
  private lastActive = new Map<number, number | null>()
  private rects: Record<number, Rect> = {}
  private overlay = false
  private closedUrls: string[] = []
  private pdf = new PdfViewerHelper()
  private groups = new Map<number, TabGroup & { spaceId: number }>()
  private nextGroupId = 1
  /** One empty view shared by every unloaded tab, so they hold no page and no renderer process. */
  private inert: WebContentsView | null = null
  private shownBefore = new Set<number>()

  private fullscreenId: number | null = null
  private notice: FullscreenNotice
  private escHold: NodeJS.Timeout | null = null
  private lastFind = ''
  private sessionStore = new JsonStore<{
    tabs: Array<{
      url: string
      spaceId: number
      title?: string
      favicon?: string | null
      groupId?: number | null
    }>
    active: number
    groups?: Array<TabGroup & { spaceId: number }>
  }>('session-v2', { tabs: [], active: 0 })
  private sessionTimer: NodeJS.Timeout | null = null

  constructor(
    private win: BrowserWindow,
    private session: Session,
    /** In-memory session for private tabs: nothing in it outlives them. */
    private privateSession: Session,
    private deps: {
      settings: SettingsStore
      history: HistoryStore
      bookmarks: BookmarkStore
      spaces: SpaceStore
      dumps: DumpStore
      tor: TorManager
      /** In-memory session whose traffic goes through Tor's local proxy (and nowhere else). */
      torSession: Session
    }
  ) {
    this.activeSpaceId = deps.spaces.activeId()
    this.notice = new FullscreenNotice(win)
    this.pip = new PipController({
      mainWin: win,
      viewRadius: VIEW_RADIUS,
      onChange: () => this.refresh(),
      onReturn: (id) => this.activate(id)
    })
    win.on('resize', () => this.applyVisibility())
    // Timers outlive the window while the app quits (an update restarts it): they must not touch it then.
    const timers = [
      setInterval(() => {
        if (this.win.isDestroyed() || !this.win.isFocused()) return
        for (const id of this.visibleIds()) if (this.tabs.get(id)?.dirty) void this.snapshot(id)
      }, THUMB_INTERVAL_MS),
      setInterval(() => this.sweepMemory(), MEMORY_SWEEP_MS)
    ]
    for (const t of timers) t.unref()
    win.once('closed', () => timers.forEach(clearInterval))
    nativeTheme.on('updated', () => this.applyDarkening())
  }

  // ---- queries ----

  initialData(): InitialData {
    const thumbs: Record<number, string> = {}
    for (const [id, t] of this.tabs) if (t.thumb) thumbs[id] = t.thumb
    return { state: this.state(), thumbs }
  }

  private state(): TabsState {
    const tabs: TabInfo[] = []
    for (const [id, t] of this.tabs) {
      if (t.spaceId !== this.activeSpaceId) continue
      const wc = liveContents(t)
      if (!wc) continue
      // The error page stands in for the page that failed, so the address bar keeps showing that one.
      const url = t.failed ? t.failed.url : wc.getURL() || t.pending?.url || t.firstUrl
      tabs.push({
        id,
        url,
        title: wc.getTitle() || t.pending?.title || '',
        favicon: t.favicon,
        loading: wc.isLoading(),
        groupId: t.groupId,
        private: t.private,
        tor: t.tor,
        capture: t.capture,
        pip: this.pip.tabId === id,
        unloaded: t.unloaded,
        audible: wc.isCurrentlyAudible(),
        muted: wc.audioMuted,
        bookmarked: this.deps.bookmarks.has(url),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward()
      })
    }
    return {
      tabs,
      activeId: this.activeId,
      layout: this.layout,
      spaces: this.deps.spaces.list(),
      activeSpaceId: this.activeSpaceId,
      tabGroups: [...this.groups.values()]
        .filter((g) => g.spaceId === this.activeSpaceId)
        .map(({ id, name, color, collapsed }) => ({ id, name, color, collapsed }))
    }
  }

  /** Ids of the active space's tabs, in display order. */
  private own(): number[] {
    return [...this.tabs].filter(([, t]) => t.spaceId === this.activeSpaceId).map(([id]) => id)
  }

  /** Close the tab showing one of Panes' own pages (the welcome page, once it is done with). */
  closeInternal(page: string): void {
    for (const [id, t] of [...this.tabs]) {
      if (liveContents(t)?.getURL().startsWith(`panes://${page}`)) this.close(id)
    }
  }

  /** Let the user click an element on the active page; reports its selector, or null if they cancelled. */
  pickElement(done: (selector: string | null) => void): void {
    const tab = this.current()
    const wc = tab && liveContents(tab)
    if (!wc) return done(null)
    const onMessage = (e: { message: string }): void => {
      if (!e.message.startsWith(ZAP_PREFIX)) return
      wc.off('console-message', onMessage)
      done(e.message.slice(ZAP_PREFIX.length) || null)
    }
    wc.on('console-message', onMessage)
    wc.focus() // so Esc reaches the page
    wc.executeJavaScript(ZAP_SCRIPT, true).catch(() => {
      wc.off('console-message', onMessage)
      done(null)
    })
  }

  /** The active tab's address and space: what the site settings panel is about. */
  activeSite(): { url: string; spaceId: number; contentsId: number } | null {
    const tab = this.current()
    const wc = tab && liveContents(tab)
    if (!tab || !wc) return null
    return {
      url: tab.failed ? tab.failed.url : wc.getURL(),
      spaceId: tab.spaceId,
      contentsId: wc.id
    }
  }

  /**
   * Put each page's boost (a dark mode and tint set for its site in its space) into the page. A style
   * sheet only lives as long as the document, so this runs on every new page and after every change.
   */
  applyBoosts(): void {
    for (const tab of this.tabs.values()) void this.applyBoost(tab)
  }

  /**
   * Put the page's current boost in place of the last one. Edits arrive many times a second (a slider being
   * dragged), and swapping a style sheet is asynchronous: run one swap at a time per tab, and when more
   * edits arrive meanwhile just do one more swap with the newest, or sheets pile up and an old one can win.
   */
  private async applyBoost(tab: Tab): Promise<void> {
    if (tab.boosting) {
      tab.boostAgain = true
      return
    }
    tab.boosting = true
    try {
      do {
        tab.boostAgain = false
        const wc = liveContents(tab)
        if (!wc || tab.unloaded) return
        const key = siteKey(wc.getURL())
        const theme = key ? this.deps.spaces.get(tab.spaceId)?.sites[key] : undefined
        const css = theme ? siteThemeCss(theme) : ''
        try {
          if (tab.boostKey) await wc.removeInsertedCSS(tab.boostKey)
          tab.boostKey = null
          tab.boostKey = css ? await wc.insertCSS(css, { cssOrigin: 'user' }) : null
        } catch {
          tab.boostKey = null // the page went away mid-call
        }
      } while (tab.boostAgain)
    } finally {
      tab.boosting = false
    }
  }

  /** Where the active tab's page sits in the window, for things that hang off its corner. */
  activeRect(): Rect | null {
    return this.activeId === null ? null : (this.rects[this.activeId] ?? null)
  }

  private current(): Tab | null {
    return this.activeId === null ? null : (this.tabs.get(this.activeId) ?? null)
  }

  /** Tabs whose views are on screen: the whole tiled group when the active tab is in one, else just the active tab. */
  private visibleIds(): number[] {
    if (this.activeId === null) return []
    const group = this.layout ? leaves(this.layout) : []
    return group.includes(this.activeId) ? group : [this.activeId]
  }

  private isBlank(tab: Tab): boolean {
    const wc = liveContents(tab)
    return !wc || (!tab.hasUrl && wc.getURL() === '')
  }

  // ---- tab lifecycle ----

  private sessionFor(tab: { private: boolean; tor: boolean }): Session {
    return tab.tor ? this.deps.torSession : tab.private ? this.privateSession : this.session
  }

  private makeView(isPrivate = false, isTor = false): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: this.sessionFor({ private: isPrivate, tor: isTor }),
        sandbox: true,
        // like Chrome: a page may not start playing sound until you have interacted with it
        autoplayPolicy: 'document-user-activation-required',
        preload: join(__dirname, '../preload/internal.js')
      }
    })
    view.setBorderRadius(VIEW_RADIUS)
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)
    this.win.contentView.addChildView(view)
    return view
  }

  private inertView(): WebContentsView {
    this.inert ??= new WebContentsView({ webPreferences: { sandbox: true } })
    return this.inert
  }

  /** Drop a tab's page. The shared inert view is never closed. */
  private destroyView(tab: Tab): void {
    if (tab.unloaded) return
    this.win.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
  }

  create(
    input = '',
    activate = true,
    spaceId = this.activeSpaceId,
    lazy?: { title: string; favicon: string | null },
    isPrivate = false,
    isTor = false
  ): number {
    const url = resolveInput(input, this.deps.settings.searchUrl())
    const unloaded = !!(url && lazy)

    const id = this.nextId++
    const tab: Tab = {
      view: unloaded ? this.inertView() : this.makeView(isPrivate, isTor),
      private: isPrivate || isTor,
      tor: isTor,
      capture: NO_CAPTURE,
      favicon: null,
      thumb: null,
      thumbAt: 0,
      thumbSharp: false,
      thumbSize: { w: 0, h: 0 },
      thumbTimer: null,
      dirty: true,
      hasUrl: false,
      spaceId,
      pending: null,
      unloaded,
      lastShownAt: Date.now(),
      groupId: null,
      darkened: false,
      boostKey: null,
      boosting: false,
      boostAgain: false,
      failed: null,
      flat: false,
      keyLock: false,
      awaiting: false,
      firstUrl: ''
    }
    this.tabs.set(id, tab)
    if (!unloaded) this.wire(id, tab)

    if (url) {
      tab.hasUrl = true
      if (lazy) {
        tab.pending = { url, title: lazy.title }
        tab.favicon = lazy.favicon
      } else {
        tab.view.webContents.loadURL(url).catch(() => {}) // ERR_ABORTED on redirects is normal
      }
    }
    if (activate) this.activate(id, true)
    else this.refresh()
    return id
  }

  /** `askForAddress`: a blank tab you just opened should take typing straight away; one you merely switched to should not pop the command bar open. */
  activate(id: number, askForAddress = false): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (tab.spaceId !== this.activeSpaceId) this.enterSpace(tab.spaceId)
    this.activeId = id
    const group = tab.groupId === null ? undefined : this.groups.get(tab.groupId)
    if (group) group.collapsed = false // opening a tab in a folded group unfolds it
    this.refresh()
    if (this.isBlank(tab)) {
      this.win.webContents.focus()
      if (askForAddress) this.command('focus-address')
    } else if (!this.overlay) {
      tab.view.webContents.focus()
    }
  }

  close(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (this.pip.tabId === id) this.pip.stop() // the page must be back in this window before it is closed
    const url = tab.pending?.url || liveContents(tab)?.getURL()
    if (url && !tab.private) this.closedUrls.push(url)

    if (this.layout) this.setLayout(removeTab(this.layout, id))
    const ids = this.own()
    const idx = ids.indexOf(id)
    if (tab.thumbTimer) clearTimeout(tab.thumbTimer)
    this.tabs.delete(id)
    this.destroyView(tab)
    if (tab.private) this.forgetPrivateIfDone()

    if (this.activeId !== id) return this.refresh()
    this.activeId = null
    const next = ids[idx + 1] ?? ids[idx - 1]
    if (next !== undefined) this.activate(next)
    else this.create() // never leave the window tab-less
  }

  /** A tab that leaves no trace: its own cookies and storage, gone when the last private tab closes. */
  newPrivateTab(input = ''): number {
    return this.create(input, true, this.activeSpaceId, undefined, true)
  }

  /** A private tab through Tor: once Tor is up (it is started now if it is not), else nothing opens. */
  newTorTab(input = ''): void {
    const open = (): void => {
      if (this.deps.tor.get().state === 'ready') {
        this.create(input, true, this.activeSpaceId, undefined, true, true)
      }
    }
    if (this.deps.tor.get().state === 'ready') return open()
    this.openInternal('settings') // where the progress is shown
    void this.deps.tor.start(this.deps.settings.get().torSnowflake).then(open)
  }

  private forgetPrivateIfDone(): void {
    if ([...this.tabs.values()].some((t) => t.private)) return
    void this.deps.torSession
      .clearStorageData()
      .then(() => this.deps.torSession.clearCache())
      .catch(() => undefined)
    void this.privateSession
      .clearStorageData()
      .then(() => this.privateSession.clearCache())
      .catch(() => undefined)
  }

  reopenClosed(): void {
    const url = this.closedUrls.pop()
    if (url) this.create(url)
  }

  step(delta: 1 | -1): void {
    const ids = this.own()
    if (ids.length < 2 || this.activeId === null) return
    const i = ids.indexOf(this.activeId)
    this.activate(ids[(i + delta + ids.length) % ids.length])
  }

  private activateIndex(i: number): void {
    const ids = this.own()
    const id = i === 8 ? ids[ids.length - 1] : ids[i] // Ctrl+9 jumps to the last tab
    if (id !== undefined) this.activate(id)
  }

  /** Start loading a restored tab. Called whenever a tab is about to be shown. */
  private ensureLoaded(id: number, tab: Tab): void {
    if (!tab.pending) return
    const { url } = tab.pending
    tab.pending = null
    if (tab.unloaded) {
      tab.view = this.makeView(tab.private, tab.tor)
      tab.flat = false
      tab.unloaded = false
      this.wire(id, tab)
    }
    this.load(tab, url)
  }

  /**
   * Load a restored tab's page. Its view has shown nothing yet, so revealing it at once would flash
   * blank white; it stays hidden, with the tab's snapshot (or a placeholder) showing in its place,
   * until the page has painted.
   */
  private load(tab: Tab, url: string): void {
    const wc = tab.view.webContents
    tab.awaiting = true
    tab.firstUrl = url
    let timer: NodeJS.Timeout = setTimeout(() => release(), AWAIT_PAINT_MAX_MS)
    const onReady = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => release(), FIRST_PAINT_MS) // dom-ready comes just before the first frame
    }
    const release = (): void => {
      clearTimeout(timer)
      if (wc.isDestroyed()) return
      wc.off('dom-ready', onReady)
      wc.off('did-fail-load', release)
      wc.off('did-stop-loading', release)
      if (!tab.awaiting) return
      tab.awaiting = false
      this.refresh() // re-applies visibility, which now reveals the view
    }
    wc.on('dom-ready', onReady)
    wc.on('did-fail-load', release)
    wc.on('did-stop-loading', release)
    wc.loadURL(url).catch(() => {}) // ERR_ABORTED on redirects is normal
  }

  /**
   * Open saved tabs when the user chose to restore, otherwise a fresh blank tab. Only the active tab
   * loads; the rest wait until they are shown, so a pile of tabs never all start playing at once.
   */
  restoreOrNew(): void {
    const saved = this.sessionStore.value
    const known = new Set(this.deps.spaces.list().map((sp) => sp.id))
    if (this.deps.settings.get().startup === 'restore' && saved.tabs.length > 0) {
      for (const g of saved.groups ?? []) {
        if (!known.has(g.spaceId)) continue
        this.groups.set(g.id, { ...g })
        this.nextGroupId = Math.max(this.nextGroupId, g.id + 1)
      }
      const ids = saved.tabs.map((t) => {
        const id = this.create(
          t.url,
          false,
          known.has(t.spaceId) ? t.spaceId : this.activeSpaceId,
          {
            title: t.title ?? '',
            favicon: t.favicon ?? null
          }
        )
        const tab = this.tabs.get(id)
        const g = t.groupId == null ? undefined : this.groups.get(t.groupId)
        if (tab && g && g.spaceId === tab.spaceId) tab.groupId = g.id
        return id
      })
      const own = ids.filter((id) => this.tabs.get(id)?.spaceId === this.activeSpaceId)
      const pick = ids[Math.min(saved.active, ids.length - 1)]
      this.activate(own.includes(pick) ? pick : (own[0] ?? this.create()))
    } else {
      this.create()
    }
  }

  /** Write the open tabs to the session store (debounced; shutdown() writes it immediately). */
  private persistSession(): void {
    if (this.sessionTimer) return
    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = null
      this.writeSession()
    }, 1500)
  }

  private writeSession(): void {
    const tabs: Array<{
      url: string
      spaceId: number
      title: string
      favicon: string | null
      groupId: number | null
    }> = []
    let active = 0
    for (const [id, t] of this.tabs) {
      if (t.private) continue // private tabs are never written down
      const wc = liveContents(t)
      const url = t.pending?.url ?? wc?.getURL() ?? ''
      if (!/^(https?|file):/i.test(url)) continue
      if (id === this.activeId) active = tabs.length
      tabs.push({
        url,
        spaceId: t.spaceId,
        title: t.pending?.title ?? wc?.getTitle() ?? '',
        favicon: t.favicon,
        groupId: t.groupId
      })
    }
    const used = new Set(tabs.map((t) => t.groupId))
    const groups = [...this.groups.values()].filter((g) => used.has(g.id))
    this.sessionStore.value = { tabs, active, groups }
    this.sessionStore.save()
  }

  /** The window is closing: bring a floating video back (so its window does not keep the app alive) and save the session now. */
  shutdown(): void {
    this.pip.stop()
    void this.privateSession.clearStorageData().catch(() => undefined)
    void this.deps.torSession.clearStorageData().catch(() => undefined)
    this.deps.tor.stop()
    if (this.sessionTimer) clearTimeout(this.sessionTimer)
    this.sessionTimer = null
    this.writeSession()
  }

  // ---- spaces ----

  /** Park the current space's layout and active tab, then make `id` the active space (no tab activation). */
  private enterSpace(id: number): void {
    this.layouts.set(this.activeSpaceId, this.layout)
    this.lastActive.set(this.activeSpaceId, this.activeId)
    this.activeSpaceId = id
    this.deps.spaces.setActive(id)
    this.layout = this.layouts.get(id) ?? null
    const own = this.own()
    const remembered = this.lastActive.get(id)
    this.activeId = remembered != null && own.includes(remembered) ? remembered : (own[0] ?? null)
  }

  /** While the light or dark scheme flips under the pages, they stay out of sight behind their pictures. */
  private settling = false
  private settleTimer: NodeJS.Timeout | null = null

  private settle(ms: number): void {
    this.settling = true
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      this.settling = false
      this.settleTimer = null
      this.applyVisibility()
    }, ms)
    this.settleTimer.unref()
  }

  switchSpace(id: number): void {
    if (id === this.activeSpaceId || !this.deps.spaces.get(id)) return
    const dark = nativeTheme.shouldUseDarkColors
    this.enterSpace(id)
    // Going from a dark space to a light one (or back) repaints every page: do not show that happening.
    if (nativeTheme.shouldUseDarkColors !== dark) this.settle(170)
    if (this.activeId === null) this.create()
    else this.activate(this.activeId)
  }

  /** Make a new space and switch to it. */
  createSpace(): ReturnType<SpaceStore['add']> {
    const space = this.deps.spaces.add()
    this.switchSpace(space.id)
    return space
  }

  updateSpace(id: number, patch: SpacePatch): void {
    this.deps.spaces.update(id, patch)
    this.refresh()
  }

  /** Delete a space and close every tab in it. The last space cannot be deleted. */
  deleteSpace(id: number): void {
    const list = this.deps.spaces.list()
    if (list.length <= 1 || !this.deps.spaces.get(id)) return
    if (id === this.activeSpaceId) {
      this.switchSpace((list.find((sp) => sp.id !== id) as { id: number }).id)
    }
    for (const [tid, t] of [...this.tabs]) {
      if (t.spaceId !== id) continue
      if (t.thumbTimer) clearTimeout(t.thumbTimer)
      this.tabs.delete(tid)
      this.destroyView(t)
    }
    this.layouts.delete(id)
    this.lastActive.delete(id)
    this.deps.spaces.remove(id)
    this.refresh()
  }

  /** Move a tab to another space (it leaves any split it was in). */
  moveTabToSpace(tabId: number, spaceId: number): void {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.spaceId === spaceId || !this.deps.spaces.get(spaceId)) return
    const wasActive = this.activeId === tabId
    if (this.layout) this.setLayout(removeTab(this.layout, tabId))
    tab.spaceId = spaceId
    tab.groupId = null // groups belong to one space
    if (wasActive) {
      this.activeId = null
      const next = this.own()[0]
      if (next !== undefined) this.activate(next)
      else this.create()
    } else {
      this.refresh()
    }
  }

  /** Dev aid: save a PNG of the active tab so layout problems can be inspected without a screen. */
  async debugShot(file: string): Promise<void> {
    const cur = this.current()
    console.log(
      '[debug] active',
      this.activeId,
      'url',
      cur?.view.webContents.getURL(),
      'bounds',
      JSON.stringify(cur?.view.getBounds()),
      'visible',
      cur?.view.getVisible(),
      'rects',
      JSON.stringify(this.rects),
      'overlay',
      this.overlay
    )
    const img = await cur?.view.webContents.capturePage()
    if (img) writeFileSync(file, img.toPNG())
    const ui = await this.win.webContents.capturePage()
    writeFileSync(file.replace('.png', '-ui.png'), ui.toPNG())
  }

  /** Float the current tab's video in a small always-on-top window, or bring it back. */
  togglePip(): void {
    if (this.pip.tabId !== null) return this.pip.stop()
    const tab = this.current()
    if (tab && this.activeId !== null) void this.pip.start({ id: this.activeId, view: tab.view })
  }

  exitPip(): void {
    this.pip.stop()
  }

  /** Dev aid: the state of picture in picture. */
  debugPip(): Promise<unknown> {
    return this.pip.debugInfo()
  }

  /** Dev aid: the page of the current tab. */
  debugContents(): WebContents | undefined {
    return this.current()?.view.webContents
  }

  /** Dev aid: which tabs have actually started loading. */
  debugTabs(): Array<{ id: number; shownUrl: string; loaded: string; pending: boolean }> {
    return [...this.tabs].map(([id, t]) => ({
      id,
      shownUrl: this.state().tabs.find((x) => x.id === id)?.url ?? '(other space)',
      loaded: liveContents(t)?.getURL() ?? '',
      pending: !!t.pending
    }))
  }

  /** Dev aid: drag the theme picker's wheel with real mouse events and report whether the space changed. */
  async debugPicker(): Promise<void> {
    const wc = this.current()?.view.webContents
    if (!wc) return console.log('[picker] no tab')
    const spaces = (): Promise<string> =>
      wc.executeJavaScript('window.panesInternal.spacesList().then((l) => JSON.stringify(l[0]))')
    console.log('[picker] before', await spaces())
    const rect = JSON.parse(
      await wc.executeJavaScript(
        "(() => { const el = document.querySelector('.tp-wheel'); el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}) })()"
      )
    )
    const cx = Math.round(rect.x + rect.w / 2)
    const cy = Math.round(rect.y + rect.h / 2)
    const at = (dx: number, dy: number): { x: number; y: number } => ({ x: cx + dx, y: cy + dy })
    wc.sendInputEvent({ type: 'mouseDown', ...at(60, 0), button: 'left', clickCount: 1 })
    for (const [dx, dy] of [
      [55, 10],
      [40, 40],
      [0, 60],
      [-40, 40]
    ]) {
      wc.sendInputEvent({ type: 'mouseMove', ...at(dx, dy), modifiers: ['leftbuttondown'] })
      await new Promise((r) => setTimeout(r, 40))
    }
    wc.sendInputEvent({ type: 'mouseUp', ...at(-40, 40), button: 'left', clickCount: 1 })
    await new Promise((r) => setTimeout(r, 500))
    console.log('[picker] after ', await spaces())
  }

  // ---- navigation ----

  /** Focus the tab already showing this internal page, or open it in a new tab. */
  openInternal(page: InternalPage): void {
    const url = internalUrl(page)
    for (const [id, t] of this.tabs) {
      if (t.spaceId === this.activeSpaceId && liveContents(t)?.getURL().startsWith(url)) {
        return this.activate(id)
      }
    }
    this.create(url)
  }

  toggleBookmark(): void {
    const tab = this.current()
    if (!tab) return
    const wc = tab.view.webContents
    if (!/^https?:/i.test(wc.getURL())) return
    this.deps.bookmarks.toggle(wc.getURL(), wc.getTitle(), tab.favicon)
    this.refresh()
  }

  find(text: string, forward = true): void {
    const wc = this.current()?.view.webContents
    if (!wc) return
    if (!text) return this.stopFind()
    const isNew = text !== this.lastFind
    this.lastFind = text
    wc.findInPage(text, isNew ? {} : { forward, findNext: true })
  }

  stopFind(): void {
    this.lastFind = ''
    this.current()?.view.webContents.stopFindInPage('clearSelection')
  }

  private zoom(delta: number | null): void {
    const wc = this.current()?.view.webContents
    if (!wc) return
    const base = this.defaultZoom(this.current()?.spaceId)
    const next = delta === null ? base : wc.getZoomLevel() + delta
    const level = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
    wc.setZoomLevel(level)
    // the zoom belongs to the site: it comes back whenever the site is opened (none kept when it is the default)
    const key = siteKey(wc.getURL())
    if (!key) return
    const rest = { ...this.deps.settings.get().siteZoom }
    if (level === base) delete rest[key]
    else rest[key] = level
    this.deps.settings.update({ siteZoom: rest })
  }

  /** How large pages start out in a space: its own setting, else the general one. */
  defaultZoom(spaceId?: number): number {
    const own = spaceId === undefined ? undefined : this.deps.spaces.get(spaceId)?.ui.pageZoom
    return own ?? this.deps.settings.get().pageZoom
  }

  /** Put each page at the zoom saved for its site (100% where none is saved). */
  applyZoom(): void {
    const saved = this.deps.settings.get().siteZoom
    for (const tab of this.tabs.values()) {
      const wc = liveContents(tab)
      if (!wc || tab.unloaded) continue
      const key = siteKey(wc.getURL())
      const level = key ? (saved[key] ?? this.defaultZoom(tab.spaceId)) : 0
      if (key && wc.getZoomLevel() !== level) wc.setZoomLevel(level)
    }
  }

  private setFullscreen(id: number | null): void {
    this.fullscreenId = id
    this.win.setFullScreen(id !== null)
    this.applyVisibility()
    const tab = id === null ? undefined : this.tabs.get(id)
    if (tab) {
      let host = ''
      try {
        host = new URL(liveContents(tab)?.getURL() ?? '').host
      } catch {
        // not a URL: the notice just names no site
      }
      this.notice.show(host || 'This page', tab.keyLock)
    } else {
      this.notice.hide()
      this.cancelEscHold()
      for (const t of this.tabs.values()) t.keyLock = false
    }
  }

  /** A page asked to lock the keyboard (navigator.keyboard.lock): from now on leaving full screen takes a held Esc. */
  markKeyboardLock(wc: WebContents): void {
    for (const t of this.tabs.values()) if (liveContents(t) === wc) t.keyLock = true
  }

  private cancelEscHold(): void {
    if (this.escHold) clearTimeout(this.escHold)
    this.escHold = null
  }

  /** Esc held for a second leaves full screen on a page that has the keyboard locked. */
  private trackEscHold(input: Input): boolean {
    if (input.key !== 'Escape' || this.fullscreenId === null) return false
    const tab = this.tabs.get(this.fullscreenId)
    if (!tab?.keyLock) return false
    if (input.type === 'keyUp') this.cancelEscHold()
    else if (input.type === 'keyDown' && !input.isAutoRepeat && !this.escHold) {
      this.escHold = setTimeout(() => {
        this.escHold = null
        void liveContents(tab)
          ?.executeJavaScript('document.exitFullscreen()', true)
          .catch(() => {})
      }, ESC_HOLD_MS)
    }
    return true
  }

  navigate(input: string): void {
    const url = resolveInput(input, this.deps.settings.searchUrl())
    if (!url) return
    const tab = this.current()
    if (!tab) {
      this.create(url)
      return
    }
    tab.hasUrl = true
    tab.view.webContents.loadURL(url).catch(() => {})
    tab.view.webContents.focus()
    this.refresh()
  }

  back(): void {
    this.current()?.view.webContents.navigationHistory.goBack()
  }
  forward(): void {
    this.current()?.view.webContents.navigationHistory.goForward()
  }
  reload(hard = false): void {
    const tab = this.current()
    if (!tab) return
    // Reloading an error page means trying the address that failed, not showing the error again.
    if (tab.failed) void tab.view.webContents.loadURL(tab.failed.url).catch(() => {})
    else if (hard) tab.view.webContents.reloadIgnoringCache()
    else tab.view.webContents.reload()
  }

  /** Next or previous match of the last search, or open the find bar if there has been none. */
  private findAgain(forward: boolean): void {
    if (this.lastFind) this.find(this.lastFind, forward)
    else this.command('find')
  }

  /** Move the current tab one place along the list (Ctrl+Shift+PageUp/Down). */
  private moveActive(delta: 1 | -1): void {
    if (this.activeId === null) return
    const i = this.own().indexOf(this.activeId)
    const to = i + delta
    if (i === -1 || to < 0 || to >= this.own().length) return
    this.moveTab(this.activeId, delta > 0 ? to + 1 : to)
  }

  private viewSource(): void {
    const url = this.current()?.view.webContents.getURL()
    if (!url || !/^https?:/i.test(url)) return
    const id = this.create('')
    void this.tabs.get(id)?.view.webContents.loadURL(`view-source:${url}`)
  }

  private async savePage(): Promise<void> {
    const wc = this.current()?.view.webContents
    if (!wc || !/^https?:/i.test(wc.getURL())) return
    const name = (wc.getTitle() || 'page')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .slice(0, 80)
    const { canceled, filePath } = await dialog.showSaveDialog(this.win, {
      defaultPath: `${name}.html`,
      filters: [{ name: 'Web page', extensions: ['html'] }]
    })
    if (!canceled && filePath) await wc.savePage(filePath, 'HTMLComplete').catch(() => {})
  }

  private async openFile(): Promise<void> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.win, {
      properties: ['openFile']
    })
    if (!canceled && filePaths[0]) this.create(pathToFileURL(filePaths[0]).href)
  }
  stop(): void {
    this.current()?.view.webContents.stop()
  }

  // ---- split view (tiling layout) ----

  /** Single place the layout changes: drops degenerate layouts and keeps a group contiguous in the tab list. */
  private setLayout(next: LayoutNode | null): void {
    this.layout = normalizeLayout(next)
    const group = this.layout ? leaves(this.layout) : []
    if (group.length < 2) return
    const ids = [...this.tabs.keys()]
    const first = Math.min(...group.map((g) => ids.indexOf(g)))
    const rest = ids.filter((i) => !group.includes(i))
    const at = ids.slice(0, first).filter((i) => !group.includes(i)).length
    const ordered = [...rest.slice(0, at), ...group, ...rest.slice(at)]
    this.tabs = new Map(ordered.map((i) => [i, this.tabs.get(i)!]))
  }

  private layoutWith(targetId: number): LayoutNode {
    return this.layout && leaves(this.layout).includes(targetId) ? this.layout : leaf(targetId)
  }

  /** Open id beside the active tab (to its right). */
  splitWith(id: number): void {
    if (this.activeId === null || id === this.activeId || !this.tabs.has(id)) return
    const base = this.layoutWith(this.activeId)
    this.setLayout(leaves(base).includes(id) ? base : insertTab(base, this.activeId, id, 'right'))
    this.activate(id)
  }

  /** Dissolve the whole group; every tab stays open. */
  unsplit(keepId?: number): void {
    this.setLayout(null)
    if (keepId !== undefined && this.tabs.has(keepId)) this.activate(keepId)
    else this.refresh()
  }

  /** Mute or unmute a whole site: its open tabs now, and any tab that goes there later. */
  setSiteMuted(key: string, muted: boolean): void {
    const rest = this.deps.settings.get().mutedSites.filter((s) => s !== key)
    this.deps.settings.update({ mutedSites: muted ? [...rest, key] : rest })
    for (const t of this.tabs.values()) {
      const wc = liveContents(t)
      if (wc && siteKey(wc.getURL()) === key) wc.audioMuted = muted
    }
    this.refresh()
  }

  toggleMute(id: number): void {
    const tab = this.tabs.get(id)
    const wc = tab && liveContents(tab)
    if (!wc) return
    wc.audioMuted = !wc.audioMuted
    this.refresh()
  }

  /** Take one pane out of the group (the tab stays open). */
  closePane(id: number): void {
    if (!this.layout) return
    const group = leaves(this.layout)
    this.setLayout(removeTab(this.layout, id))
    const rest = group.filter((g) => g !== id)
    if (this.activeId === id && rest.length > 0) this.activate(rest[0])
    else this.refresh()
  }

  /** Take a pane out of the group and show it on its own, full size. */
  popOut(id: number): void {
    if (!this.layout || !this.tabs.has(id)) return
    this.setLayout(removeTab(this.layout, id))
    this.activate(id)
  }

  /** Load an address or search in a new tab and tile it beside the current one. */
  openInSplit(input: string): void {
    const base = this.activeId
    const id = this.create(input, false)
    if (base !== null) {
      this.activate(base)
      this.splitWith(id)
    }
  }

  toggleSplit(): void {
    if (this.activeId === null) return
    if (this.visibleIds().length > 1) return this.unsplit(this.activeId)
    const ids = this.own()
    const partner =
      ids.length > 1 ? ids[(ids.indexOf(this.activeId) + 1) % ids.length] : this.create('', false)
    this.splitWith(partner)
  }

  /**
   * Drop a tab (from the sidebar or another pane) on an edge of the pane showing targetId.
   * Edges tile it beside that pane; centre swaps with it or replaces it.
   */
  dropTab(id: number, targetId: number, edge: Edge | 'center'): void {
    if (!this.tabs.has(id) || (targetId !== ROOT_TARGET && !this.tabs.has(targetId))) return
    // The target may belong to a group other than the active one (dragging in the overview).
    const next = applyDrop(this.layout, id, targetId, edge)
    if (next === this.layout) return
    this.setLayout(next)
    this.activate(id)
  }

  /** Move the focused pane one step in a direction by swapping with its nearest neighbour there. */
  movePane(dir: Edge): void {
    const id = this.activeId
    const me = id === null ? undefined : this.rects[id]
    if (id === null || !me || this.visibleIds().length < 2) return
    const cx = me.x + me.width / 2
    const cy = me.y + me.height / 2
    let best: number | null = null
    let bestDist = Infinity
    for (const other of this.visibleIds()) {
      const r = this.rects[other]
      if (other === id || !r) continue
      const dx = r.x + r.width / 2 - cx
      const dy = r.y + r.height / 2 - cy
      const ahead = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'top' ? -dy : dy
      if (ahead <= 0) continue
      const dist = ahead + (dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)) * 2
      if (dist < bestDist) {
        best = other
        bestDist = dist
      }
    }
    if (best !== null) this.dropTab(id, best, 'center')
  }

  updateRatios(path: number[], ratios: number[]): void {
    if (!this.layout) return
    this.layout = setRatios(this.layout, path, ratios)
    this.refresh()
  }

  /** Reorder a tab in the sidebar. A tab in a group moves its whole group with it. */
  moveTab(id: number, index: number): void {
    if (!this.tabs.has(id)) return
    const group = this.layout && leaves(this.layout).includes(id) ? leaves(this.layout) : [id]
    const own = this.own()
    const rest = own.filter((i) => !group.includes(i))
    const removedBefore = group.filter((g) => own.indexOf(g) < index).length
    const at = Math.max(0, Math.min(rest.length, index - removedBefore))
    rest.splice(at, 0, ...group)
    this.reorder(rest)
    // A tab dropped between two members of a sidebar group joins it; one dragged away leaves it.
    for (const gid of group) {
      const tab = this.tabs.get(gid)
      if (tab) tab.groupId = groupAfterMove(rest, this.groupOf, gid)
    }
    this.setLayout(this.layout) // a loose tab dropped inside a split group gets pushed out of it
    this.refresh()
  }

  /** Write a new order for this space's tabs back into the slots they occupy in the global order. */
  private reorder(order: number[]): void {
    const own = new Set(this.own())
    const global = [...this.tabs.keys()]
    let k = 0
    for (let i = 0; i < global.length; i++) if (own.has(global[i])) global[i] = order[k++]
    this.tabs = new Map(global.map((i) => [i, this.tabs.get(i)!]))
  }

  /** A click inside a split pane moves focus (and the address bar) to that pane's tab. */
  private focusPane(id: number): void {
    if (this.overlay || this.activeId === id || !this.visibleIds().includes(id)) return
    this.activeId = id
    this.refresh()
  }

  // ---- layout / overlay ----

  setRects(rects: Record<number, Rect>): void {
    const next: Record<number, Rect> = {}
    for (const [id, r] of Object.entries(rects)) {
      next[Number(id)] = {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.max(0, Math.round(r.width)),
        height: Math.max(0, Math.round(r.height))
      }
    }
    this.rects = next
    this.applyVisibility()
  }

  /** `sharp`: the pictures stand in for the pages on screen, so they must match them pixel for pixel. */
  /** The page views are shifted right by this much, at their own size (the window clips what runs off). */
  private slideX = 0

  setSlide(px: number): void {
    const next = Math.max(0, Math.min(600, Math.round(px)))
    if (next === this.slideX) return
    this.slideX = next
    this.applyVisibility()
  }

  async setOverlay(open: boolean, snapshot = true, sharp = false): Promise<void> {
    if (open && snapshot) {
      // Only views whose picture is old are worth waiting for; with a recent one the overlay opens at once.
      const now = Date.now()
      // An unchanged page keeps the picture it has; only a new or changed one is worth a GPU readback.
      const stale = this.visibleIds().filter((id) => {
        const t = this.tabs.get(id)
        return (
          !!t &&
          (!t.thumb ||
            (sharp && !t.thumbSharp) ||
            !this.thumbFits(id, t) ||
            (t.dirty && now - t.thumbAt > THUMB_FRESH_MS))
        )
      })
      if (stale.length > 0) {
        await Promise.race([
          Promise.all(stale.map((id) => this.snapshot(id, sharp))),
          new Promise((resolve) => setTimeout(resolve, SNAPSHOT_TIMEOUT_MS))
        ])
      }
    }
    this.overlay = open
    this.refresh()
    const cur = this.current()
    if (open) this.win.webContents.focus()
    else if (cur && !this.isBlank(cur)) cur.view.webContents.focus()
  }

  /**
   * Position the visible tabs' views. While a UI overlay is open they are parked off-screen at full
   * size instead of hidden: a hidden view drops its picture and flashes black when it returns, a
   * parked one keeps it. Blank tabs show renderer UI instead of a view.
   */
  private applyVisibility(): void {
    if (this.win.isDestroyed()) return
    const shown = this.visibleIds()
    const [w, h] = this.win.getContentSize()
    for (const [id, tab] of this.tabs) {
      if (id === this.pip.tabId) continue // its page is in the floating window
      const normal = shown.includes(id) ? (this.rects[id] ?? null) : null
      // HTML5 fullscreen (video etc.) takes the whole window for that tab only.
      const placed =
        this.fullscreenId !== null
          ? id === this.fullscreenId
            ? { x: 0, y: 0, width: w, height: h }
            : null
          : normal
      const rect =
        placed && this.overlay
          ? { ...placed, x: PARKED_X }
          : placed && this.fullscreenId === null
            ? { ...placed, x: placed.x + this.slideX }
            : placed
      const show = rect !== null && !this.isBlank(tab) && !tab.awaiting && !this.settling
      // A full-screen page has no window edge to be rounded against.
      const flat = this.fullscreenId === id
      if (flat !== tab.flat && !tab.unloaded) {
        tab.flat = flat
        tab.view.setBorderRadius(flat ? 0 : VIEW_RADIUS)
      }
      if (show) tab.view.setBounds(rect)
      tab.view.setVisible(show)
    }
  }

  // ---- events ----

  private wire(id: number, tab: Tab): void {
    const wc = tab.view.webContents
    const refresh = (): void => this.refresh()

    if (process.env['PANES_DEBUG']) {
      wc.on('console-message', (e) =>
        console.log('[tab console]', e.message, e.sourceId + ':' + e.lineNumber)
      )
      wc.on('did-fail-load', (_e, code, desc, url) =>
        console.log('[tab fail-load]', code, desc, url)
      )
      wc.on('render-process-gone', (_e, d) => console.log('[tab gone]', d.reason))
      wc.on('preload-error', (_e, path, err) => console.log('[tab preload-error]', path, err))
    }
    this.pdf.attach(wc)
    const tabSession = this.sessionFor(tab)
    // Nothing about the real network address may leave through WebRTC in a Tor tab.
    if (tab.tor) wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    applyChromeIdentity(wc, tabSession.getUserAgent())
    wc.on('did-create-window', (child) =>
      applyChromeIdentity(child.webContents, tabSession.getUserAgent())
    )
    wc.on('did-start-loading', refresh)
    wc.on('dom-ready', () => {
      // The start-of-document script can miss the very first page of a tab (it is registered as that page
      // loads); running it again is harmless, it only installs once.
      void wc.executeJavaScript(CAPTURE_SCRIPT).catch(() => undefined)
      this.applyDarkening() // covers tabs created or restored after the theme last changed
      this.applyZoom()
      tab.boostKey = null // a new document starts without the old sheet
      void this.applyBoost(tab)
    })
    wc.on('audio-state-changed', () => {
      tab.dirty = true
      refresh()
    })
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      // -3 is a navigation cut short (a redirect, a download, you clicking elsewhere): not a failure
      if (!isMainFrame || code === -3 || url.startsWith('panes://')) return
      tab.failed = { url, code, desc }
      const back = wc.navigationHistory.canGoBack()
      const space = this.deps.spaces.get(tab.spaceId)
      const theme = space ? { color: space.color, tint: space.tint } : undefined
      void wc.loadURL(errorPageUrl(url, code, desc, back, theme)).catch(() => {})
    })
    wc.on('did-navigate', () => {
      if (!wc.getURL().startsWith('panes://error')) tab.failed = null
      tab.keyLock = false
      if (!tab.private) this.deps.history.add(wc.getURL(), wc.getTitle())
      this.lastFind = ''
      refresh()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame && !tab.private) this.deps.history.add(url, wc.getTitle())
      refresh()
    })
    wc.on('page-title-updated', (_e, title) => {
      tab.dirty = true
      if (!tab.private) this.deps.history.updateMeta(wc.getURL(), { title })
      refresh()
    })
    wc.on('found-in-page', (_e, r) => {
      if (id === this.activeId) {
        this.send('ui:find-result', { active: r.activeMatchOrdinal, matches: r.matches })
      }
    })
    wc.on('context-menu', (_e, params) =>
      showContextMenu(this.win, wc, params, {
        openTab: (u) =>
          tab.tor
            ? this.create(u, true, this.activeSpaceId, undefined, true, true)
            : tab.private
              ? this.newPrivateTab(u)
              : this.create(u),
        openPrivate: (u) => this.newPrivateTab(u),
        openSplit: (u) => {
          const base = this.activeId
          const nid = this.create(u, false)
          if (base !== null) {
            this.activate(base)
            this.splitWith(nid)
          }
        },
        pip: () => this.togglePip(),
        searchUrl: (t) => this.deps.settings.searchUrl() + encodeURIComponent(t)
      })
    )
    // A video in picture in picture is fullscreen inside its own small window, not the browser window.
    wc.on('enter-html-full-screen', () => {
      if (this.pip.tabId !== id) this.setFullscreen(id)
    })
    wc.on('leave-html-full-screen', () => {
      if (this.pip.tabId === id) this.pip.refullscreen()
      else this.setFullscreen(null)
    })
    wc.on('did-stop-loading', () => {
      tab.dirty = true
      this.refresh()
      this.scheduleSnapshot(id)
    })
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      tab.favicon = null
      tab.capture = NO_CAPTURE // a new page starts with nothing captured
      // a muted site stays muted wherever its tabs go
      const site = siteKey(details.url)
      if (site && siteListed(site, this.deps.settings.get().mutedSites)) wc.audioMuted = true
      // panes:// pages are separate documents, so the view shows its own background between
      // navigations. Match the page's stage colour so moving between them does not flash white.
      const space = this.deps.spaces.get(tab.spaceId)
      const dark =
        space?.mode === 'system' || !space ? nativeTheme.shouldUseDarkColors : space.mode === 'dark'
      tab.view.setBackgroundColor(
        details.url.startsWith('panes://') && space
          ? stageBackground(space.color, space.tint, dark)
          : '#ffffff'
      )
    })
    wc.on('console-message', (e) => {
      const state = parseCapture(e.message)
      if (!state) return
      tab.capture = state
      refresh()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? null
      if (!tab.private) this.deps.history.updateMeta(wc.getURL(), { favicon: tab.favicon })
      this.refresh()
    })
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown') tab.dirty = true
      this.handleKey(e, input)
    })
    wc.on('focus', () => this.focusPane(id))
    // Ctrl+wheel over a page drives the tab stack (page zoom is not wired up, so nothing fights it).
    wc.on('input-event', (_e, ev) => {
      if (ev.type === 'mouseDown' || ev.type === 'mouseWheel') tab.dirty = true
      if (ev.type === 'mouseDown') this.focusPane(id)
      if (ev.type !== 'mouseWheel') return
      if (!ev.modifiers?.some((m) => m === 'control' || m === 'ctrl')) return
      // The built-in PDF viewer (and anything else in an extension frame) uses Ctrl+wheel to zoom; leave it
      // that, and let Ctrl+Tab open the stack there.
      if (wc.mainFrame.framesInSubtree.some((f) => f.url.startsWith('chrome-extension://'))) return
      const { wheelTicksY = 0, deltaY = 0 } = ev as MouseWheelInputEvent
      // Chromium's wheel delta is positive for scroll-up; the renderer expects DOM units (down is positive).
      this.send('ui:stack-wheel', wheelTicksY !== 0 ? -wheelTicksY * 100 : -deltaY)
    })
    wc.setWindowOpenHandler(({ url, features, disposition }) => {
      // Sign-in flows (Google, Figma, ...) open a popup and message the page that opened it, so a
      // real popup window must stay linked to its opener. Ordinary links still become tabs.
      if (disposition === 'new-window' || /\b(width|height|popup)\b/i.test(features)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            backgroundColor: '#ffffff',
            webPreferences: { session: tabSession, sandbox: true }
          }
        }
      }
      this.openLink(url, id)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (e, url) => {
      if (this.externalScheme(url)) {
        e.preventDefault()
        this.openLink(url, id)
      }
    })
  }

  private externalScheme(url: string): boolean {
    try {
      return OPEN_EXTERNALLY.has(new URL(url).protocol)
    } catch {
      return false
    }
  }

  /** mailto:/tel: go to the OS; everything else becomes a tab. */
  private openLink(url: string, from?: number): void {
    if (this.externalScheme(url)) return void shell.openExternal(url)
    const opener = from === undefined ? undefined : this.tabs.get(from)
    const id = opener?.tor
      ? this.create(url, true, this.activeSpaceId, undefined, true, true)
      : opener?.private
        ? this.newPrivateTab(url)
        : this.create(url)
    // A link opened from a tab in a group joins that group, at its bottom.
    const group = from === undefined ? null : (this.tabs.get(from)?.groupId ?? null)
    if (group !== null) this.addToGroup(id, group)
  }

  /** Browser shortcuts. Registered on every tab and the UI window so they work wherever focus is. */
  handleKey(event: Event, input: Input): void {
    if (this.trackEscHold(input)) return // the page still sees the key; only the exit is timed
    if (input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Meta')) {
      this.send('ui:stack-release')
      return
    }
    if (input.type !== 'keyDown') return
    const mod = input.control || input.meta
    const k = input.key.toLowerCase()
    let handled = true

    if (mod && !input.alt && !input.shift) {
      if (k === 't') this.create()
      else if (k === 'w' && this.activeId !== null) this.close(this.activeId)
      else if (k === 'f4' && this.activeId !== null) this.close(this.activeId)
      else if (k === 'l') this.command('focus-address')
      else if (k === 'r') this.reload()
      else if (k === 'f5') this.reload(true)
      else if (k === 'u') this.viewSource()
      else if (k === 'b') this.command('toggle-sidebar')
      else if (k === '\\') this.toggleSplit()
      else if (k === 'f') this.command('find')
      else if (k === 'd') this.toggleBookmark()
      else if (k === 'h') this.openInternal('history')
      else if (k === 'j') this.openInternal('downloads')
      else if (k === ',') this.openInternal('settings')
      else if (k === 'p') this.current()?.view.webContents.print()
      else if (k === '=' || k === '+') this.zoom(ZOOM_STEP)
      else if (k === '-') this.zoom(-ZOOM_STEP)
      else if (k === '0') this.zoom(null)
      else if (k === 'tab')
        this.send('ui:stack-wheel', STACK_STEP) // hold Ctrl and tap Tab: fly through the stack, release to land
      else if (k === 'pagedown') this.step(1)
      else if (k === 'pageup') this.step(-1)
      else if (/^[1-9]$/.test(k)) this.activateIndex(Number(k) - 1)
      else handled = false
    } else if (mod && input.alt && !input.shift) {
      const target = /^[1-9]$/.test(k) ? this.deps.spaces.list()[Number(k) - 1] : undefined
      if (target) this.switchSpace(target.id)
      else handled = false
    } else if (mod && input.shift && !input.alt) {
      if (k === ' ') this.command('open-stack')
      else if (k === 'r') this.reload(true)
      else if (k === 'n') this.newPrivateTab()
      else if (k === 'delete')
        this.openInternal('settings') // clear browsing data lives there
      else if (k === 'b') this.openInternal('bookmarks')
      else if (k === 'j' || k === 'c') this.current()?.view.webContents.toggleDevTools()
      else if (k === 'pagedown') this.moveActive(1)
      else if (k === 'pageup') this.moveActive(-1)
      else if (k === 'tab') this.send('ui:stack-wheel', -STACK_STEP)
      else if (k === 'a') this.command('toggle-taskview')
      else if (k === 't') this.reopenClosed()
      else if (k === 'o') this.openInternal('bookmarks')
      else if (k === 'd') this.dumpTabs()
      else if (k === 'i') this.current()?.view.webContents.toggleDevTools()
      else if (k === '+') this.zoom(ZOOM_STEP)
      else handled = false
    } else if (input.alt && input.shift && !mod) {
      const dirs: Record<string, Edge> = {
        arrowleft: 'left',
        arrowright: 'right',
        arrowup: 'top',
        arrowdown: 'bottom'
      }
      if (dirs[k]) this.movePane(dirs[k])
      else handled = false
    } else if (input.alt && !mod && !input.shift) {
      if (k === 'arrowleft') this.back()
      else if (k === 'arrowright') this.forward()
      else if (k === 'p') this.togglePip()
      else if (k === 'd') this.command('focus-address')
      else handled = false
    } else if (k === 'f5' && !mod) {
      this.reload()
    } else if (k === 'f6' && !mod) {
      this.command('focus-address')
    } else if (k === 'f3' && !mod) {
      this.findAgain(!input.shift)
    } else if (k === 'f11' && !mod) {
      this.win.setFullScreen(!this.win.isFullScreen())
    } else if (k === 'f12' && !mod) {
      this.current()?.view.webContents.toggleDevTools()
    } else if (k === 'escape' && this.fullscreenId !== null) {
      this.setFullscreen(null)
    } else {
      handled = false
    }
    if (handled) event.preventDefault()
  }

  // ---- thumbnails ----

  private scheduleSnapshot(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (tab.thumbTimer) clearTimeout(tab.thumbTimer)
    tab.thumbTimer = setTimeout(() => void this.snapshot(id), 800)
  }

  /** Whether a tab's picture has the shape of the page as it is now (it is shown in its place). */
  private thumbFits(id: number, t: Tab): boolean {
    const r = this.rects[id]
    if (!r || t.thumbSize.w === 0) return false
    return Math.abs(r.width - t.thumbSize.w) <= 3 && Math.abs(r.height - t.thumbSize.h) <= 3
  }

  private async snapshot(id: number, sharp = false): Promise<void> {
    const tab = this.tabs.get(id)
    if (!tab || this.overlay || !this.visibleIds().includes(id) || this.isBlank(tab)) return
    try {
      tab.dirty = false // before the capture: a change that lands while it runs marks it again
      const img = await tab.view.webContents.capturePage()
      if (img.isEmpty() || !this.tabs.has(id)) return
      const width = sharp ? img.getSize().width : THUMB_WIDTH
      const picture = sharp ? img : img.resize({ width, quality: 'good' })
      const jpeg = picture.toJPEG(sharp ? 82 : 72)
      tab.thumb = 'data:image/jpeg;base64,' + jpeg.toString('base64')
      tab.thumbSharp = sharp
      const at = this.rects[id]
      tab.thumbSize = at ? { w: at.width, h: at.height } : { w: 0, h: 0 }
      tab.thumbAt = Date.now()
      this.win.webContents.send('tabs:thumb', id, tab.thumb)
    } catch {
      // tab closed or view torn down mid-capture
    }
  }

  // ---- dark websites ----

  /**
   * Pages already follow a dark space through prefers-color-scheme (Electron's theme matches the space).
   * This also asks Chromium to darken the pages that have no dark theme of their own, which it leaves
   * alone on pages that do. Needs the DevTools protocol; cheap, and only attached while it is wanted.
   */
  private setDarkening(tab: Tab, on: boolean): void {
    const wc = liveContents(tab)
    if (!wc || tab.unloaded || tab.darkened === on) return
    tab.darkened = on
    const dbg = wc.debugger
    void (async () => {
      try {
        if (on) {
          if (!dbg.isAttached()) dbg.attach('1.3')
          await dbg.sendCommand('Emulation.setAutoDarkModeOverride', { enabled: true })
        } else if (dbg.isAttached()) {
          await dbg.sendCommand('Emulation.setAutoDarkModeOverride', {})
          // stays attached: the Chrome identity override lives on the same debugger
        }
      } catch {
        tab.darkened = !on // the page went away mid-call; the next sweep retries
      }
    })()
  }

  /** Bring every tab in line with the current theme and the setting. */
  applyDarkening(): void {
    const on = this.deps.settings.get().darkenSites && nativeTheme.shouldUseDarkColors
    for (const t of this.tabs.values()) this.setDarkening(t, on)
  }

  // ---- tab groups ----

  private groupOf = (id: number): number | null => this.tabs.get(id)?.groupId ?? null

  /** A group with no tabs left is gone. */
  private pruneGroups(): void {
    const used = new Set([...this.tabs.values()].map((t) => t.groupId))
    for (const id of this.groups.keys()) if (!used.has(id)) this.groups.delete(id)
  }

  /** Take a tab out of its group, parking it just after the group so the group stays one run. */
  private leaveGroup(id: number): void {
    const tab = this.tabs.get(id)
    const old = tab?.groupId
    if (!tab || old == null) return
    tab.groupId = null
    this.reorder(placeInGroup(this.own(), this.groupOf, id, old))
  }

  /** Save what is open in this space as a session; `close` also closes those tabs (a quick clear-out). */
  dumpTabs(close = false): TabDump | null {
    const open = this.state().tabs.filter((t) => !t.private)
    const dump = this.deps.dumps.add(dumpableTabs(open))
    if (dump && close) {
      const saved = new Set(dump.tabs.map((t) => t.url))
      for (const t of open) if (saved.has(t.url)) this.close(t.id)
    }
    return dump
  }

  /** Open a saved session as a new group of tabs, named after it. */
  openDump(id: number): void {
    const dump = this.deps.dumps.get(id)
    if (!dump || dump.tabs.length === 0) return
    const ids = dump.tabs.map((t, i) => this.create(t.url, i === 0))
    this.createGroup(ids[0], dump.name)
    for (const tid of ids.slice(1)) this.addToGroup(tid, this.tabs.get(ids[0])?.groupId ?? -1)
  }

  createGroup(tabId: number, name = ''): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    this.leaveGroup(tabId)
    const used = [...this.groups.values()]
      .filter((g) => g.spaceId === tab.spaceId)
      .map((g) => g.color)
    const id = this.nextGroupId++
    this.groups.set(id, {
      id,
      spaceId: tab.spaceId,
      name,
      color: nextGroupColor(used),
      collapsed: false
    })
    tab.groupId = id
    this.refresh()
    if (!name) this.send('ui:rename-group', id) // a new group is named straight away
  }

  addToGroup(tabId: number, groupId: number): void {
    const tab = this.tabs.get(tabId)
    const group = this.groups.get(groupId)
    if (!tab || !group || group.spaceId !== tab.spaceId || tab.groupId === groupId) return
    this.leaveGroup(tabId)
    tab.groupId = groupId
    this.reorder(placeInGroup(this.own(), this.groupOf, tabId, groupId))
    this.refresh()
  }

  removeFromGroup(tabId: number): void {
    this.leaveGroup(tabId)
    this.refresh()
  }

  updateGroup(id: number, raw: unknown): void {
    const group = this.groups.get(id)
    if (!group) return
    Object.assign(group, sanitizeGroupPatch(raw))
    this.refresh()
  }

  private ungroup(id: number): void {
    for (const t of this.tabs.values()) if (t.groupId === id) t.groupId = null
    this.refresh()
  }

  private closeGroup(id: number): void {
    const members = [...this.tabs].filter(([, t]) => t.groupId === id).map(([tid]) => tid)
    for (const tid of members) this.close(tid)
  }

  tabMenu(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    const others = [...this.groups.values()].filter(
      (g) => g.spaceId === tab.spaceId && g.id !== tab.groupId
    )
    const items: MenuItemConstructorOptions[] = [
      { label: 'Add to new group', click: () => this.createGroup(id) }
    ]
    const saveItems: MenuItemConstructorOptions[] = [
      { label: 'Save all tabs as a session', click: () => this.dumpTabs() },
      { label: 'Save all tabs and close them', click: () => this.dumpTabs(true) }
    ]
    if (others.length > 0) {
      items.push({
        label: 'Add to group',
        submenu: others.map((g) => ({
          label: g.name || 'Unnamed group',
          click: () => this.addToGroup(id, g.id)
        }))
      })
    }
    if (tab.groupId !== null) {
      items.push({ label: 'Remove from group', click: () => this.removeFromGroup(id) })
    }
    const wcOf = liveContents(tab)
    const key = wcOf ? siteKey(wcOf.getURL()) : null
    const siteMuted = !!key && siteListed(key, this.deps.settings.get().mutedSites)
    items.push(
      { type: 'separator' },
      {
        label: wcOf?.audioMuted ? 'Unmute tab' : 'Mute tab',
        enabled: !!wcOf,
        click: () => this.toggleMute(id)
      },
      {
        label: siteMuted ? 'Unmute site' : 'Mute site',
        enabled: !!key,
        click: () => key && this.setSiteMuted(key, !siteMuted)
      },
      ...saveItems,
      { type: 'separator' },
      {
        label: tab.unloaded ? 'Tab is unloaded' : 'Unload tab',
        // the page on screen cannot be thrown away; pages that are not web pages have nothing to reload from
        enabled: !tab.unloaded && id !== this.activeId,
        click: () => {
          this.unload(id)
          this.refresh()
        }
      },
      { label: 'Close tab', click: () => this.close(id) }
    )
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  /** The browser's own pages and actions, for layouts with no sidebar footer to hold them. */
  appMenu(x: number, y: number): void {
    const page = (label: string, to: InternalPage): MenuItemConstructorOptions => ({
      label,
      click: () => this.openInternal(to)
    })
    Menu.buildFromTemplate([
      { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => this.create() },
      { label: 'New Tor tab', click: () => this.newTorTab() },
      {
        label: 'New private tab',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => this.newPrivateTab()
      },
      {
        label: 'Reopen closed tab',
        accelerator: 'CmdOrCtrl+Shift+T',
        click: () => this.reopenClosed()
      },
      { type: 'separator' },
      page('Bookmarks', 'bookmarks'),
      page('History', 'history'),
      page('Downloads', 'downloads'),
      page('Passwords', 'passwords'),
      page('Private and Tor', 'privacy'),
      { type: 'separator' },
      { label: 'Find in page', accelerator: 'CmdOrCtrl+F', click: () => this.command('find') },
      { label: 'Save all tabs as a session', click: () => this.dumpTabs() },
      { label: 'Save page as...', click: () => void this.savePage() },
      { label: 'Open file...', click: () => void this.openFile() },
      { label: 'View page source', accelerator: 'CmdOrCtrl+U', click: () => this.viewSource() },
      { type: 'separator' },
      { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => this.openInternal('settings') },
      page('About and updates', 'software')
    ]).popup({ window: this.win, x, y })
  }

  groupMenu(id: number): void {
    const group = this.groups.get(id)
    if (!group) return
    Menu.buildFromTemplate([
      { label: 'Rename', click: () => this.send('ui:rename-group', id) },
      {
        label: group.collapsed ? 'Expand' : 'Collapse',
        click: () => this.updateGroup(id, { collapsed: !group.collapsed })
      },
      {
        label: 'Colour',
        submenu: GROUP_COLORS.map((color, i) => ({
          label: GROUP_COLOR_NAMES[i],
          type: 'radio' as const,
          checked: group.color.toLowerCase() === color,
          click: () => this.updateGroup(id, { color })
        }))
      },
      { type: 'separator' },
      { label: 'Ungroup', click: () => this.ungroup(id) },
      { label: 'Close group', click: () => this.closeGroup(id) }
    ]).popup({ window: this.win })
  }

  // ---- memory saver ----

  private memoryPolicy(): MemoryPolicy {
    const st = this.deps.settings.get()
    return {
      enabled: st.memorySaver,
      idleMin: st.unloadIdleMin,
      maxLoaded: st.maxLoadedTabs,
      otherSpaces: st.unloadOtherSpaces,
      neverSites: st.neverUnloadSites
    }
  }

  private memoryFacts(): TabFacts[] {
    const facts: TabFacts[] = []
    const visible = this.visibleIds()
    for (const [id, t] of this.tabs) {
      const wc = liveContents(t)
      const url = t.unloaded || !wc ? '' : wc.getURL()
      const isWeb = /^(https?|file):/i.test(url)
      let host = ''
      try {
        host = new URL(url).hostname
      } catch {
        // not a URL: no host to match against the never-unload list
      }
      facts.push({
        id,
        loaded: isWeb && !t.unloaded && !t.awaiting,
        visible: visible.includes(id),
        busy:
          !!wc &&
          !t.unloaded &&
          (wc.isCurrentlyAudible() ||
            wc.isLoading() ||
            wc.isDevToolsOpened() ||
            this.pip.tabId === id ||
            this.fullscreenId === id),
        host,
        inActiveSpace: t.spaceId === this.activeSpaceId,
        lastShownAt: t.lastShownAt
      })
    }
    return facts
  }

  /** Unload tabs the memory saver says are done with. `force` takes every tab that is safe to take. */
  sweepMemory(force = false): number {
    if (this.win.isDestroyed()) return 0
    const ids = pickUnloads(this.memoryFacts(), this.memoryPolicy(), Date.now(), force)
    for (const id of ids) this.unload(id)
    if (ids.length > 0) this.refresh()
    return ids.length
  }

  /** Throw a tab's page away, keeping its title, icon, snapshot and address so it comes back when shown. */
  private unload(id: number): void {
    const tab = this.tabs.get(id)
    const wc = tab && liveContents(tab)
    if (!tab || !wc || tab.unloaded) return
    const url = wc.getURL()
    if (!/^(https?|file):/i.test(url)) return
    tab.pending = { url, title: wc.getTitle() }
    tab.firstUrl = url
    tab.awaiting = false
    if (tab.thumbTimer) clearTimeout(tab.thumbTimer)
    tab.thumbTimer = null
    this.destroyView(tab)
    tab.view = this.inertView()
    tab.unloaded = true
    tab.darkened = false
  }

  /** Memory Panes is using across all its processes, and how many tabs hold a page. */
  memoryStats(): MemoryStats {
    const kb = app.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0)
    let unloaded = 0
    for (const t of this.tabs.values()) if (t.unloaded) unloaded++
    return {
      usedMb: Math.round(kb / 1024),
      loaded: this.tabs.size - unloaded,
      unloaded,
      runningMode: runningMode(),
      totalGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10
    }
  }

  // ---- renderer sync ----

  private refresh(): void {
    if (this.win.isDestroyed()) return
    this.pruneGroups()
    const visible = this.visibleIds()
    const now = Date.now()
    // A tab is "recently shown" while on screen and from the moment it leaves it, so idle time starts then.
    for (const id of new Set([...visible, ...this.shownBefore])) {
      const t = this.tabs.get(id)
      if (t) t.lastShownAt = now
    }
    this.shownBefore = new Set(visible)
    for (const id of visible) {
      const t = this.tabs.get(id)
      if (t) this.ensureLoaded(id, t)
    }
    this.applyVisibility()
    this.persistSession()
    if (!this.win.isDestroyed()) this.win.webContents.send('tabs:state', this.state())
  }

  private command(cmd: UiCommand): void {
    // The page view holds the keyboard when the shortcut is pressed; the find box can only take typing once the
    // window's own page does.
    if (cmd === 'find' && !this.win.isDestroyed()) this.win.webContents.focus()
    this.send('ui:command', cmd)
  }

  private send(channel: string, ...args: unknown[]): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, ...args)
  }
}
