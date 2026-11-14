import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeTheme,
  shell,
  webFrameMain,
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
  TAB_GROUPS,
  type TabGroup
} from '@shared/tabgroups'
import { browseWith } from '@shared/browse'
import { stageBackground } from '@shared/color'
import { siteListed, ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN } from '@shared/memory'
import { siteKey, siteThemeCss } from '@shared/sitetheme'
import {
  holdCapture,
  mergeCapture,
  NO_CAPTURE,
  NO_HOLD,
  isCapturing,
  parseCapture,
  stopCaptureScript,
  sameCapture,
  type CaptureHold,
  type CaptureKind,
  type CaptureState
} from '@shared/capture'
import {
  FRESH_MEMO,
  NO_ATTENTION,
  noteFavicon,
  noteNotification,
  noteSeen,
  noteTitle,
  RING_MS,
  spaceAttention,
  tabAttention,
  windowAttention,
  type AttentionMemo,
  type TabAttention
} from '@shared/attention'
import { NOTIFY_SCRIPT, parseNotify } from '@shared/notify'
import { ESC_SCRIPT, isPreviewEsc } from '@shared/previewEsc'
import { TaskbarAttention } from './attention'
import { dumpableTabs, type TabDump } from '@shared/dumps'
import type { DumpStore } from './dumps'
import type { TorManager } from './tor'
import { ZAP_PREFIX, ZAP_SCRIPT } from '@shared/zap'
import { errorPageUrl } from '@shared/errors'
import { FullscreenNotice } from './fullscreenNotice'
import { totalmem } from 'os'
import { VIDEO_RECT_SCRIPT, videoRegion, type VideoRegion } from '@shared/ai/tabStream'
import { applyIdentity, followIdentity } from './identity'
import { wantsChromeIdentity } from '@shared/identity'
import { PdfViewerHelper } from './pdf'
import { runningMode } from './performance'
import {
  pickPreloads,
  pickRests,
  pickUnloads,
  type MemoryPolicy,
  type Rest,
  type RestFacts,
  type TabFacts
} from '@shared/memory'
import { join } from 'path'
import { internalUrl, type InternalPage } from '@shared/settings'
import { pdfFileName } from '@shared/print'
import {
  applyDrop,
  insertTab,
  leaf,
  leaves,
  normalizeLayout,
  removeTab,
  ROOT_TARGET,
  remapLayout,
  rowOf,
  setRatios,
  type Edge,
  type LayoutNode
} from '@shared/layout'
import { keepHistory, type NavHistory } from '@shared/navHistory'
import { bulkOpenList } from '@shared/selection'
import type {
  InitialData,
  MemoryStats,
  OpenItem,
  PageMenuPick,
  Rect,
  SpacePatch,
  TabCardInfo,
  TabInfo,
  TabsState,
  UiCommand
} from '@shared/types'
import { displayHost, resolveInput } from '@shared/url'
import { pageCaps, zoomPercent } from '@shared/ai/previewBar'
import { isWelcome, kindOf, type TabKind } from '@shared/tabkind'
import { showContextMenu } from './contextMenu'
import { feedbackMailto } from './feedback'
import { mailtoWebUrl } from '@shared/mailto'
import { PipController } from './pip'
import type { BookmarkStore, HistoryStore } from './history'
import type { SettingsStore } from './settings'
import type { ActiveSite } from './sites'
import type { SpaceStore } from './spaces'
import { JsonStore } from './store'

const THUMB_WIDTH = 800
const CANVAS_THUMB_WIDTH = 480 // pictures taken for the canvas are small at once: about 30 KB each
const THUMB_INTERVAL_MS = 2500
const SNAPSHOT_TIMEOUT_MS = 250 // overlays open without waiting longer than this for snapshots
/** After dom-ready, a freshly loaded page is revealed once it has drawn content, or after this long at most. */
const HOLD_AFTER_READY_MS = 800
/**
 * Resolves two frames after the page's first contentful paint (at once if that is past): what a browser waits for
 * before it swaps the old picture for a new page (paint holding), so the page is never seen drawing itself in.
 */
const PAINTED_SCRIPT = `new Promise((r) => {
  const done = () => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))
  const fcp = (list) => list.some((e) => e.name === 'first-contentful-paint')
  if (fcp(performance.getEntriesByType('paint'))) return done()
  try {
    const o = new PerformanceObserver((l) => { if (fcp(l.getEntries())) { o.disconnect(); done() } })
    o.observe({ type: 'paint', buffered: true })
  } catch { done() }
})`
const AWAIT_PAINT_MAX_MS = 2500 // never keep a view hidden longer than this, whatever the page does
const VIEW_RADIUS = 12
const ZOOM_STEP = 0.5
const ZOOM_MIN = ZOOM_LEVEL_MIN
const ZOOM_MAX = ZOOM_LEVEL_MAX
const PARKED_X = -20000 // where views wait, out of sight, while an overlay is open
const MEMORY_SWEEP_MS = 30_000
/** A tab out of sight this long paints out of sight before it is shown again (see warm), at most this long. */
const WARM_AFTER_MS = 3000
const WARM_MAX_MS = 350
/** Pre-loading after a restart waits this long after the start, and this long between tabs (see preloadRecent). */
const PRELOAD_START_MS = 5000
const PRELOAD_GAP_MS = 1500
/** The tabs' state goes to the window at most this often (one frame). */
const PUSH_EVERY_MS = 16
const ESC_HOLD_MS = 1000
const SOUND_HOLD_MS = 20_000 // how long a quiet stretch of playing media keeps its speaker
const STACK_STEP = 160 // one card of the tab stack, in the renderer's wheel units
const OPEN_EXTERNALLY = new Set(['mailto:', 'tel:'])
/** Tor is left running this long after the last Tor tab closes. */
const TOR_IDLE_MS = 5 * 60_000
/** How long a message about something that just happened stays in the window. */
const NOTICE_MS = 4000

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
  pending: { url: string; title: string; history?: NavHistory | null } | null
  /** No page of its own: `view` is the shared inert one. Loading builds a real view. */
  unloaded: boolean
  /** Last time the tab was on screen (ms since epoch), for the memory saver. */
  lastShownAt: number
  /** Sidebar group (not the tiled split group). Members of a group are always neighbours. */
  groupId: number | null
  /** A media element on the page is playing (it may be between sounds), and when sound last started or stopped. */
  media: boolean
  lastSoundAt: number
  /** Whether the page currently has Chromium's automatic dark mode forced on. */
  darkened: boolean
  /** Key of the style sheet a boost put into the page, so it can be taken out again. */
  /** A private tab: kept out of history, the saved session and saved sessions, in its own in-memory session. */
  private: boolean
  tor: boolean
  /** A Tor tab opened before Tor was ready: what to load once it is ('' for a blank tab); null when it is not waiting. */
  torTarget: string | null
  /** The address being loaded, from the moment it is entered until its page commits (see state). */
  navUrl: string | null
  /** What the tab shows the page capturing: what its frames report (see CAPTURE_SCRIPT), held through short gaps. */
  capture: CaptureState
  /** The last report of each frame that has one, by frame tree node id. */
  captureFrames: Map<number, CaptureState>
  captureHold: CaptureHold
  captureTimer: NodeJS.Timeout | null
  /** Pinned tabs sit together at the start of the list. */
  pinned: boolean
  /** The tab's Chrome identity is in place; nothing is loaded before it is. Set up when the tab first loads something. */
  identity: Promise<void> | null
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
  /** Put to rest while hidden (caches given back, or frozen); woken as it is shown or scripted (see pickRests). */
  rest: Rest
  /**
   * Coming back on screen, it paints out of sight first (see warm), while its picture stands in: a page that was
   * hidden a while has no frame to show, and revealed at once it would draw itself in like a page loading.
   */
  warming: boolean
  warmSize: { width: number; height: number } | null
  /** Last time it was on screen, kept across restarts (lastShownAt restarts with Panes): what pre-loading goes by. */
  usedAt: number
  /** Where the first load went, so the tab has an address while the page has not committed yet. */
  firstUrl: string
  /** What is new in the tab since the person last looked (see shared/attention). */
  attention: AttentionMemo
  /**
   * The notification hook is in the current document (null: not, or not yet), with the ids of the notifications it
   * reported. Only those can be clicked, so a page cannot pull itself to the front by printing a fake click.
   */
  notes: Set<number> | null
}

/** The tab's live WebContents, or null while it is being torn down (reading it then would throw). */
function liveContents(tab: Tab): WebContents | null {
  const wc = tab.view.webContents as WebContents | undefined
  return wc && !wc.isDestroyed() ? wc : null
}

/** True when some audio or video element in the page plays (not paused, not ended, with data to play). */
const PLAYING_SCRIPT = `[...document.querySelectorAll('video, audio')].some((m) => !m.paused && !m.ended && m.readyState > 2)`

/** A live page's back/forward list, as worth keeping (see keepHistory). */
function historyOf(wc: WebContents): NavHistory | null {
  try {
    return keepHistory(wc.navigationHistory.getAllEntries(), wc.navigationHistory.getActiveIndex())
  } catch {
    return null
  }
}

export class TabManager {
  private tabs = new Map<number, Tab>() // insertion order is display order
  /** The welcome tour is on screen: dark and alone in the window. */
  activeIsWelcome(): boolean {
    const wc = this.current() && liveContents(this.current()!)
    return !!wc && isWelcome(wc.getURL())
  }

  /** The kind of the tab on screen: its privacy picks the window's look (dark for private, purple for Tor). */
  activeKind(): TabKind {
    return kindOf(this.current())
  }

  /**
   * What the canvas board works with: while it is up, the page open in its preview (private, Tor or normal), else
   * normal: a private tab left active in the tab view behind the board does not make the whole board private. Out
   * of the board, the active tab's kind.
   */
  boardKind(): TabKind {
    if (!this.canvasMode) return this.activeKind()
    return this.previewOpen ? kindOf(this.pageTab()) : 'normal'
  }

  /** A loaded tab's page, without bringing it on screen (null for an unloaded or closed tab). */
  /**
   * A download began in a page. A tab that never showed a page of its own (opened just for that link or address) has
   * nothing to show now: it closes, as in Chrome, so no blank tab or empty canvas card is left behind. The download
   * carries on in Downloads.
   */
  downloadStarted(wc: WebContents | undefined): void {
    if (!wc) return
    for (const [id, t] of this.tabs) {
      if (liveContents(t) !== wc) continue
      const url = wc.getURL()
      const shown = !!url && url !== 'about:blank' && !url.startsWith('panes://')
      if (!shown && wc.navigationHistory.length() <= 1) this.close(id)
      return
    }
  }

  contentsOf(id: number): WebContents | null {
    const t = this.tabs.get(id)
    return t ? liveContents(t) : null
  }

  /** The page on screen, for printing. */
  activeContents(): WebContents | null {
    const t = this.current()
    return t ? liveContents(t) : null
  }
  /**
   * The page behind a web contents, for the selection chip: where its view sits in the window and its zoom. Null for a
   * private or Tor tab, one that is not a loaded web page, or one that is not on screen: nothing is offered there.
   */
  selectionHost(wc: WebContents): { view: { x: number; y: number }; zoom: number } | null {
    for (const [id, t] of this.tabs) {
      if (t.private || t.tor || t.unloaded || liveContents(t) !== wc) continue
      if (!this.visibleIds().includes(id) || this.overlay || !t.view.getVisible()) return null
      const b = t.view.getBounds()
      return { view: { x: b.x, y: b.y }, zoom: wc.getZoomFactor() }
    }
    return null
  }

  /** Ctrl+Shift+Y: show the ask chip for the page's current selection and put the keyboard on it. */
  onAskSelection: (() => void) | null = null
  /** Ctrl+P (our print view) and Ctrl+Shift+P (the system dialog). */
  onPrint: ((system: boolean) => void) | null = null
  /** Reader mode for the page on screen (wired in index.ts). */
  onReader: (() => void) | null = null

  /** Called after every state change (the permission card and the site panel follow the tab on screen). */
  onRefresh: (() => void) | null = null
  /** Called when a page view is added to the window: the downloads bin lifts itself back above it. */
  onViewAdded: (() => void) | null = null
  /**
   * AI: the shorter title to show for a tab, or null to show its own. Asked on every state push, so it must be
   * quick; it is also what decides (through the AI policy) that a private or Tor tab never gets one.
   */
  aiTitle:
    ((t: { url: string; title: string; private: boolean; tor: boolean }) => string | null) | null =
    null
  /** AI: a page has finished loading in a tab (any kind: the receiver checks the kind before touching it). */
  onPageLoaded:
    | ((p: {
        id: number
        url: string
        title: string
        private: boolean
        tor: boolean
        wc: WebContents
      }) => void)
    | null = null
  /** The dot and flash on the taskbar button while something waits and the person is away. */
  private taskbar: TaskbarAttention
  /**
   * When a real Ctrl (or Cmd) key was last down, or 0. A touchpad pinch reaches the page as a wheel event that claims
   * Ctrl is held, with no key behind it: only a wheel with the key really down opens the stack.
   */
  private ctrlAt = 0
  private ctrlHeld(): boolean {
    // the key repeats while held, so a keyUp that never arrived stops counting after a moment
    return this.ctrlAt > 0 && Date.now() - this.ctrlAt < 1500
  }
  /** The stack was opened with Shift+wheel (over a PDF), so letting go of Shift is what releases it. */
  private shiftStack = false
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
  /** Canvas mode is open: every page view is hidden for real (not just parked), so none paints or composites. */
  private canvasMode = false
  /** The one tab whose real page is shown inside the canvas, and where. */
  private liveId: number | null = null
  /**
   * The tab the canvas preview is about to show (see prepareLive): it paints out of sight until it goes live, so it
   * shows a finished frame, never an empty surface drawing itself in.
   */
  private preparedId: number | null = null
  private liveRect: Rect | null = null
  /** The preview pane last clicked or typed in (a split shows several): where page actions and Ctrl+W go. */
  private previewFocus: number | null = null
  /** The other panes of a split shown in the canvas preview beside the live page: their pages, at these rects. */
  private companions = new Map<number, Rect>()
  /**
   * The canvas preview is open (live or reader) and which tab it shows, if any: page shortcuts and actions (Ctrl+D,
   * Ctrl+F, zoom, site settings, back) go to that page instead of the hidden active tab.
   */
  private previewOpen = false
  /** The guided tour is up: the shortcuts it teaches are its to catch, not the features' (see Tour.tsx). */
  private tourOpen = false
  private previewTab: number | null = null
  /** Tabs streaming live to their canvas card (setStreaming). */
  private streaming = new Set<number>()
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
      pinned?: boolean
      history?: NavHistory | null
      /** Last on screen (ms since epoch), for pre-loading after a restart. */
      shown?: number
    }>
    active: number
    groups?: Array<TabGroup & { spaceId: number }>
    /** The canvas board was up when it was saved. */
    canvas?: boolean
    /** Per space: its split view and the tab it was on, tabs by their place in `tabs`. */
    spaces?: Array<{ spaceId: number; active: number | null; layout: LayoutNode | null }>
  }>('session-v2', { tabs: [], active: 0 })
  private sessionTimer: NodeJS.Timeout | null = null
  private pushTimer: NodeJS.Timeout | NodeJS.Immediate | null = null
  private pushedAt = 0
  private message: { id: number; text: string } | null = null
  private messageId = 0
  private messageTimer: NodeJS.Timeout | undefined
  private torIdleTimer: NodeJS.Timeout | undefined

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
      /** The Chrome user agent, for the few sites that insist on Chrome (the sessions carry the plain one). */
      chromeUa: string
      /** The app icon, for pop-up windows. */
      icon: string
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
        // a page that changed, or plays media (it changes with no event to say so), gets a fresh picture
        for (const id of this.visibleIds()) {
          const t = this.tabs.get(id)
          if (t && (t.dirty || t.media)) void this.snapshot(id)
        }
      }, THUMB_INTERVAL_MS),
      setInterval(() => this.sweepMemory(), MEMORY_SWEEP_MS)
    ]
    for (const t of timers) t.unref()
    win.once('closed', () => timers.forEach(clearInterval))
    nativeTheme.on('updated', () => this.applyDarkening())
    this.taskbar = new TaskbarAttention(win)
    // Coming back to the window is looking at the tabs on screen: what waited in them is seen.
    win.on('focus', () => this.refresh())
  }

  // ---- queries ----

  initialData(): InitialData {
    const thumbs: Record<number, string> = {}
    for (const [id, t] of this.tabs) if (t.thumb) thumbs[id] = t.thumb
    return { state: this.state(), thumbs, canvas: this.startCanvas }
  }

  /** The session was saved with the board up: it comes back on the board (see restoreOrNew), until it is left. */
  private startCanvas = false

  private state(): TabsState {
    // Every space's tabs, not only this one's: the space avatars carry what waits in the others.
    const now = Date.now()
    const waiting: Array<{ id: number; spaceId: number; attention: TabAttention }> = []
    for (const [id, t] of this.tabs) {
      const wc = liveContents(t)
      if (!wc) continue
      const facts = {
        url: wc.getURL(),
        title: wc.getTitle(),
        capture: t.capture,
        audible: this.sounding(t, wc)
      }
      waiting.push({ id, spaceId: t.spaceId, attention: tabAttention(t.attention, facts, now) })
    }
    const attention = new Map(waiting.map((w) => [w.id, w.attention]))
    const tabs: TabInfo[] = []
    for (const [id, t] of this.tabs) {
      if (t.spaceId !== this.activeSpaceId) continue
      const wc = liveContents(t)
      if (!wc) continue
      // The error page stands in for the page that failed, so the address bar keeps showing that one.
      // What was entered shows from the moment it is entered, as in Chrome, not the page being left or about:blank,
      // until the new page commits (then it is the address the page really has, after redirects).
      const going = t.navUrl && wc.isLoading() && !t.failed ? t.navUrl : null
      const url =
        t.torTarget ||
        going ||
        (t.failed ? t.failed.url : wc.getURL() || t.pending?.url || t.firstUrl)
      const here = wc.getURL()
      tabs.push({
        id,
        playing: !t.unloaded && t.media,
        url,
        title:
          (going && (here === '' || here === 'about:blank') ? displayHost(going) : wc.getTitle()) ||
          t.pending?.title ||
          '',
        favicon: t.favicon,
        loading: !!t.torTarget || wc.isLoading(),
        groupId: t.groupId,
        private: t.private,
        tor: t.tor,
        pinned: t.pinned,
        capture: t.capture,
        pip: this.pip.tabId === id,
        unloaded: t.unloaded,
        audible: this.sounding(t, wc),
        muted: wc.audioMuted,
        attention: attention.get(id) ?? NO_ATTENTION,
        aiTitle:
          this.aiTitle?.({ url, title: wc.getTitle(), private: t.private, tor: t.tor }) ?? null,
        bookmarked: this.deps.bookmarks.has(url),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward()
      })
    }
    const spaceAudio: TabsState['spaceAudio'] = {}
    for (const t of this.tabs.values()) {
      const wc = liveContents(t)
      if (!wc) continue
      const cur = (spaceAudio[t.spaceId] ??= { playing: false, muted: false })
      if (this.sounding(t, wc) && !wc.audioMuted) cur.playing = true
      else if (wc.audioMuted) cur.muted = true
    }
    return {
      tabs,
      activeId: this.activeId,
      layout: this.layout,
      spaces: this.deps.spaces.list(),
      spaceAudio,
      spaceAttention: spaceAttention(waiting),
      tor: {
        state: this.deps.tor.get().state,
        progress: this.deps.tor.get().progress,
        message: this.deps.tor.get().message,
        tabs: [...this.tabs.values()].filter((t) => t.tor).length
      },
      notice: this.message,
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

  /** Tabs of a space that are not in a group or pinned and not private (what a group suggestion is made from). */
  groupCandidates(spaceId: number): Array<{ id: number; url: string; title: string }> {
    const out: Array<{ id: number; url: string; title: string }> = []
    for (const [id, t] of this.tabs) {
      if (t.spaceId !== spaceId || t.pinned || t.private || t.groupId !== null) continue
      const wc = liveContents(t)
      if (!wc || t.unloaded) continue
      out.push({ id, url: wc.getURL(), title: wc.getTitle() })
    }
    return out
  }

  /** Every tab with a page in it (any kind), for the AI to catch up on pages opened before it was switched on. */
  loadedPages(): Array<{
    id: number
    url: string
    title: string
    private: boolean
    tor: boolean
    wc: WebContents
  }> {
    const out: ReturnType<TabManager['loadedPages']> = []
    for (const [id, t] of this.tabs) {
      const wc = liveContents(t)
      if (!wc || t.unloaded || t.failed) continue
      out.push({ id, url: wc.getURL(), title: wc.getTitle(), private: t.private, tor: t.tor, wc })
    }
    return out
  }

  /**
   * Every tab of the space on screen, for the chat panel: its address and title (a tab that is not loaded still has
   * both), whether it is the one shown, and its page when it has one. Private and Tor tabs are in the list because
   * the caller needs to know to leave them out (the chat policy does).
   */
  aiTabs(): Array<{
    id: number
    url: string
    title: string
    active: boolean
    private: boolean
    tor: boolean
    audible: boolean
    wc: WebContents | null
  }> {
    const out: ReturnType<TabManager['aiTabs']> = []
    for (const [id, t] of this.tabs) {
      if (t.spaceId !== this.activeSpaceId) continue
      const wc = t.unloaded ? null : liveContents(t)
      out.push({
        id,
        url: t.pending?.url || wc?.getURL() || t.firstUrl,
        title: t.pending?.title || wc?.getTitle() || '',
        active: id === this.activeId,
        private: t.private,
        tor: t.tor,
        audible: !!wc && !wc.isDestroyed() && wc.isCurrentlyAudible(),
        wc
      })
    }
    return out
  }

  /** The active tab's page, space and session: what the site settings panel is about. */
  activeSite(): ActiveSite | null {
    const tab = this.pageTab()
    const wc = tab && liveContents(tab)
    if (!tab || !wc) return null
    return {
      url: tab.failed ? tab.failed.url : wc.getURL(),
      title: wc.getTitle(),
      favicon: tab.favicon,
      loading: wc.isLoading(),
      spaceId: tab.spaceId,
      contentsId: wc.id,
      session: this.sessionFor(tab),
      kind: kindOf(tab),
      capture: tab.capture
    }
  }

  /** A tab's page that is not on screen (a background tab). Anything that is not a tab's page is not hidden. */
  isHidden(wc: WebContents): boolean {
    const visible = new Set(this.onScreenIds())
    for (const [id, t] of this.tabs) if (liveContents(t) === wc) return !visible.has(id)
    return false
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

  /** A page is up in the tab view (not the board, nothing laid over the pages): the touchpad swipes act on it. */
  pageShowing(): boolean {
    return !this.canvasMode && !this.overlay && this.current() !== null
  }

  /** Where the active tab's page sits in the window, for things that hang off its corner. */
  activeRect(): Rect | null {
    return this.activeId === null ? null : (this.rects[this.activeId] ?? null)
  }

  private current(): Tab | null {
    return this.activeId === null ? null : (this.tabs.get(this.activeId) ?? null)
  }

  /** The page that page actions are for: the canvas preview's while it is open (none if it has no tab), else current. */
  /** pageTab's id (see pageTab). */
  private pageTabId(): number | null {
    const t = this.pageTab()
    for (const [id, x] of this.tabs) if (x === t) return id
    return null
  }

  private pageTab(): Tab | null {
    if (!this.canvasMode || !this.previewOpen) return this.current()
    const f = this.previewFocus
    const id =
      f !== null && (f === this.liveId || this.companions.has(f))
        ? f
        : (this.liveId ?? this.previewTab)
    return id === null ? null : (this.tabs.get(id) ?? null)
  }

  /** Tabs whose views are on screen: the whole tiled group when the active tab is in one, else just the active tab. */
  private visibleIds(): number[] {
    if (this.activeId === null) return []
    const group = this.layout ? leaves(this.layout) : []
    return group.includes(this.activeId) ? group : [this.activeId]
  }

  /**
   * The tabs whose page the person sees now: the tab view's tab (or split), or on the canvas board only the page open
   * in its preview and the cards playing live. The tab view's tab is not loaded or kept for the board's sake.
   */
  private onScreenIds(): number[] {
    if (!this.canvasMode) return this.visibleIds()
    const ids = new Set([...this.streaming, ...this.companions.keys()])
    if (this.liveId !== null) ids.add(this.liveId)
    return [...ids]
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
    // a page loaded out of sight (pre-loading) lays out at its real size, not 0x0: no second layout when shown
    const at = this.activeRect()
    if (at) view.setBounds(at)
    view.setVisible(false)
    this.wakeForCalls(view.webContents)
    this.win.contentView.addChildView(view)
    this.onViewAdded?.()
    return view
  }

  /**
   * A frozen page runs no script and draws nothing: a script sent to it, or a picture asked of it, would wait until
   * it is shown. Every such call wakes it first, here in one place for every caller (it rests again at the next sweep
   * if it is still hidden and idle).
   */
  private wakeForCalls(wc: WebContents): void {
    const calls = wc as unknown as Record<string, (...args: unknown[]) => unknown>
    for (const name of [
      'executeJavaScript',
      'executeJavaScriptInIsolatedWorld',
      'capturePage',
      'printToPDF'
    ]) {
      const call = calls[name].bind(wc)
      calls[name] = (...args: unknown[]) => {
        const tab = [...this.tabs.values()].find((t) => !t.unloaded && t.view.webContents === wc)
        if (tab?.rest === 'frozen') this.thaw(tab)
        return call(...args)
      }
    }
  }

  /**
   * Have a tab's page paint a fresh frame out of sight, then let it be shown: placed so that only its transparent
   * rounded corner is inside the window (as captureHidden does), it counts as visible, wakes if frozen, and draws.
   * Its picture shows in its place meanwhile. Done after two animation frames in the page, or WARM_MAX_MS at most.
   * `size`: the size it will be shown at (the canvas preview's slot), else its place in the tab view.
   */
  async warm(id: number, size?: { width: number; height: number }): Promise<void> {
    const t = this.tabs.get(id)
    const wc = t && liveContents(t)
    if (
      !t ||
      !wc ||
      t.unloaded ||
      t.awaiting ||
      t.warming ||
      this.isBlank(t) ||
      wc.isLoadingMainFrame()
    )
      return
    if (t.rest === 'frozen') this.thaw(t)
    t.warming = true
    t.warmSize = size ?? null
    this.applyVisibility()
    const started = Date.now()
    try {
      await Promise.race([
        wc.executeJavaScript(
          'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))',
          false
        ),
        new Promise((r) => setTimeout(r, WARM_MAX_MS))
      ])
    } catch {
      // gone, or navigating: shown as it is
    }
    if (process.env['PANES_DEBUG'])
      console.log('[warm]', wc.getURL().slice(0, 60), Date.now() - started, 'ms')
    t.warming = false
    t.warmSize = null
    if (!this.win.isDestroyed()) this.applyVisibility()
  }

  /**
   * The pointer rests on a tab, so it is likely to be opened next: a frozen page starts running and one that was
   * unloaded starts loading, out of sight, so the click finds it ready.
   */
  prewarm(id: number): void {
    const t = this.tabs.get(id)
    if (!t || this.onScreenIds().includes(id)) return
    if (t.rest === 'frozen') this.thaw(t)
    if (t.pending && !t.private && !t.tor) {
      t.lastShownAt = Date.now() // not unloaded again by the next sweep
      this.ensureLoaded(id, t)
    }
  }

  /** Let a frozen page run again (without being shown): its caches stay given back. */
  private thaw(tab: Tab): void {
    tab.rest = 'purged'
    const wc = liveContents(tab)
    if (wc?.debugger.isAttached())
      void wc.debugger
        .sendCommand('Page.setWebLifecycleState', { state: 'active' })
        .catch(() => undefined)
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
    lazy?: { title: string; favicon: string | null; history?: NavHistory | null },
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
      torTarget: null,
      navUrl: null,
      capture: NO_CAPTURE,
      captureFrames: new Map(),
      captureHold: NO_HOLD,
      captureTimer: null,
      attention: FRESH_MEMO,
      notes: null,
      identity: null,
      pinned: false,
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
      media: false,
      lastSoundAt: 0,
      boostAgain: false,
      failed: null,
      flat: false,
      keyLock: false,
      awaiting: false,
      rest: 'awake',
      warming: false,
      warmSize: null,
      usedAt: 0,
      firstUrl: ''
    }
    this.tabs.set(id, tab)
    if (!unloaded) this.wire(id, tab)

    if (url) {
      tab.hasUrl = true
      if (lazy) {
        tab.pending = { url, title: lazy.title, history: lazy.history }
        tab.favicon = lazy.favicon
      } else {
        this.go(tab, url)
      }
    }
    // a space browsed with the canvas (or while the canvas board is open) keeps the person on the board
    const toBoard =
      activate &&
      !!url &&
      !tab.private &&
      (this.boardBrowsing(spaceId) || (this.canvasMode && spaceId === this.activeSpaceId))
    if (activate && !toBoard) this.activate(id, true)
    else this.refresh()
    if (toBoard) this.send('canvas:show-tab', id)
    this.flushState() // the caller may hand the new id to the window straight away
    return id
  }

  /**
   * Start loading an address, once the tab has taken on the identity that address wants. A first page that
   * loads before that sees one browser in its user agent and another in its client hints.
   */
  /**
   * How a pop-up (a sign-in window) looks: centred over the browser, the size the page asked for, in the colours
   * of the browser's scheme, with the browser's icon and no menu bar. The title bar stays: it shows the address
   * you are signing in on.
   */
  private popupOptions(
    features: string,
    session: Session
  ): Electron.BrowserWindowConstructorOptions {
    const asked = (name: string, fallback: number): number => {
      const m = new RegExp(`${name}=(\\d+)`, 'i').exec(features)
      return m ? Number(m[1]) : fallback
    }
    const width = Math.min(Math.max(asked('width', 480), 360), 900)
    const height = Math.min(Math.max(asked('height', 640), 400), 900)
    const at = this.win.getBounds()
    return {
      width,
      height,
      x: Math.round(at.x + (at.width - width) / 2),
      y: Math.round(at.y + (at.height - height) / 3),
      minWidth: 360,
      minHeight: 400,
      parent: this.win,
      autoHideMenuBar: true,
      title: 'Panes',
      icon: this.deps.icon,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#16161c' : '#ffffff',
      webPreferences: { session, sandbox: true }
    }
  }

  private identities(tab: { private: boolean; tor: boolean }): { plain: string; chrome: string } {
    return { plain: this.sessionFor(tab).getUserAgent(), chrome: this.deps.chromeUa }
  }

  /** `history`: a restored back/forward list to bring back with the page (its current entry is `url`). */
  private go(tab: Tab, url: string, history?: NavHistory | null): void {
    // A Tor tab with Tor not up yet holds what it was asked to load until Tor is, so a search or address typed while
    // Tor connects neither fails nor has to be typed again. (Tor is started if nothing has started it.)
    if (tab.tor && this.deps.tor.get().state !== 'ready') {
      tab.torTarget = url
      tab.hasUrl = true
      void this.deps.tor.start(this.deps.settings.get().torSnowflake)
      this.refresh()
      return
    }
    tab.navUrl = url
    this.refresh()
    const wc = tab.view.webContents
    const ids = this.identities(tab)
    const plain = (): void => void wc.loadURL(url).catch(() => {}) // ERR_ABORTED on redirects is normal
    // Restoring (scroll and forms kept, from cache) is only allowed as a view's very first load, so it cannot wait
    // for the identity's blank first page: done first, the identity set up after. Only for a page that does not need
    // the Chrome identity from its first request; one that does (Google's) loads afresh below.
    if (history && !tab.identity && wc.getURL() === '' && !wantsChromeIdentity(url)) {
      // set up once the page commits, not once it has loaded: a navigation asked for meanwhile waits on it
      const committed = new Promise<void>((resolve) => {
        const done = (): void => {
          wc.off('did-navigate', done)
          wc.off('did-fail-load', done)
          wc.off('destroyed', done)
          resolve()
        }
        wc.once('did-navigate', done)
        wc.once('did-fail-load', done)
        wc.once('destroyed', done)
      })
      wc.navigationHistory.restore(history).catch(plain)
      tab.identity = committed.then(() =>
        wc.isDestroyed() ? undefined : applyIdentity(wc, ids, url, false)
      )
      return
    }
    const ready = (tab.identity ??= applyIdentity(wc, ids, url))
    void ready.then(() => {
      if (!wc.isDestroyed()) plain() // a view that has loaded a page (the blank one) can no longer restore
    })
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
    this.focusActive(askForAddress)
  }

  /**
   * Go to a tab you asked for (the search palette, the assistant, a tab list). On the board it opens in the
   * preview over its card and the board stays; a tab of another space switches to that space as before.
   */
  show(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (this.canvasMode && tab.spaceId === this.activeSpaceId) this.send('canvas:show-tab', id)
    else this.activate(id)
  }

  /**
   * Give the keyboard to what is on screen: a blank tab's address bar lives in the window's own page, anything else
   * is the page itself. Also run once the window first shows, since showing it hands the keyboard to its own page.
   */
  focusActive(askForAddress = false): void {
    const tab = this.current()
    if (!tab) return
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
    if (tab.tor) this.torTabsChanged()
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

  /**
   * A Tor tab opens at once. If Tor is not up yet the tab waits, saying how far Tor has got, while Tor starts in the
   * background, and loads what was asked for the moment it is up. Until then Tor's session has no way out (its proxy
   * points at nothing), so nothing can load outside Tor.
   */
  newTorTab(input = ''): void {
    clearTimeout(this.torIdleTimer)
    if (this.deps.tor.get().state === 'ready') {
      this.create(input, true, this.activeSpaceId, undefined, true, true)
      return
    }
    const id = this.create('', true, this.activeSpaceId, undefined, true, true)
    const tab = this.tabs.get(id)
    if (tab) tab.torTarget = input
    void this.deps.tor.start(this.deps.settings.get().torSnowflake) // already starting: the same attempt
  }

  /** Tor's state changed and its proxy matches it: Tor tabs that were waiting load, and the window is told. */
  torChanged(): void {
    if (this.deps.tor.get().state === 'ready') {
      for (const tab of this.tabs.values()) {
        if (tab.torTarget === null) continue
        const target = tab.torTarget
        tab.torTarget = null
        const url = resolveInput(target, this.deps.settings.searchUrl())
        if (!url) continue
        tab.hasUrl = true
        this.go(tab, url)
      }
    }
    this.refresh()
  }

  /**
   * With the last Tor tab closed Tor is left running a while (another may be opened at once), then stopped, so it is
   * not left connected, using the network, with nothing to serve.
   */
  private torTabsChanged(): void {
    clearTimeout(this.torIdleTimer)
    if ([...this.tabs.values()].some((t) => t.tor)) return
    this.torIdleTimer = setTimeout(() => {
      if (![...this.tabs.values()].some((t) => t.tor)) this.deps.tor.stop()
    }, TOR_IDLE_MS)
    this.torIdleTimer.unref()
  }

  /** Say something short in the window for a few seconds. */
  private say(text: string): void {
    this.message = { id: ++this.messageId, text }
    clearTimeout(this.messageTimer)
    this.messageTimer = setTimeout(() => {
      this.message = null
      this.refresh()
    }, NOTICE_MS)
    this.messageTimer.unref()
    this.refresh()
  }

  /** Open private tabs, Tor tabs included: never saved, so a restart closes them for good. */
  privateTabCount(): number {
    let n = 0
    for (const t of this.tabs.values()) if (t.private) n++
    return n
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
    const { url, history } = tab.pending
    tab.pending = null
    if (tab.unloaded) {
      tab.view = this.makeView(tab.private, tab.tor)
      tab.identity = null // a new page: its identity is set up again (see go)
      tab.flat = false
      tab.unloaded = false
      this.wire(id, tab)
    }
    this.load(tab, url, history)
  }

  /**
   * Load a restored tab's page. Its view has shown nothing yet, so revealing it at once would flash
   * blank white; it stays hidden, with the tab's snapshot (or a placeholder) showing in its place,
   * until the page has painted.
   */
  private load(tab: Tab, url: string, history?: NavHistory | null): void {
    const wc = tab.view.webContents
    tab.awaiting = true
    tab.firstUrl = url
    let timer: NodeJS.Timeout = setTimeout(() => release(), AWAIT_PAINT_MAX_MS)
    // dom-ready, or the load ending first (a quick page): revealed once it has drawn, HOLD_AFTER_READY_MS at most
    let painting = false
    const onReady = (): void => {
      if (painting || wc.isDestroyed() || wc.getURL() === 'about:blank' || tab.navUrl) return
      painting = true
      clearTimeout(timer)
      timer = setTimeout(() => release(), HOLD_AFTER_READY_MS)
      wc.executeJavaScript(PAINTED_SCRIPT, false).then(release, () => {}) // a failure leaves it to the timer
    }
    let done = false
    const release = (): void => {
      clearTimeout(timer)
      if (done || wc.isDestroyed()) return
      done = true
      wc.off('dom-ready', onReady)
      wc.off('did-fail-load', release)
      wc.off('did-stop-loading', onReady)
      if (!tab.awaiting) return
      tab.awaiting = false
      this.refresh() // re-applies visibility, which now reveals the view
    }
    wc.on('dom-ready', onReady)
    wc.on('did-fail-load', release)
    wc.on('did-stop-loading', onReady)
    this.go(tab, url, history)
  }

  /**
   * Open saved tabs when the user chose to restore (or `always`: a restart to update), otherwise a fresh blank tab.
   * Only the active tab loads; the rest wait until they are shown, so a pile of tabs never all start playing at once.
   */
  restoreOrNew(always = false): void {
    const saved = this.sessionStore.value
    const known = new Set(this.deps.spaces.list().map((sp) => sp.id))
    if ((always || this.deps.settings.get().startup === 'restore') && saved.tabs.length > 0) {
      for (const g of TAB_GROUPS ? (saved.groups ?? []) : []) {
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
            favicon: t.favicon ?? null,
            history: t.history ? keepHistory(t.history.entries, t.history.index) : null
          }
        )
        const tab = this.tabs.get(id)
        const g = t.groupId == null ? undefined : this.groups.get(t.groupId)
        if (tab && g && g.spaceId === tab.spaceId) tab.groupId = g.id
        if (tab && t.pinned === true) tab.pinned = true
        if (tab && typeof t.shown === 'number' && Number.isFinite(t.shown)) tab.usedAt = t.shown
        return id
      })
      // each space comes back on the tab it was on, with its split view (tabs of another space are not taken in)
      const inSpace = (i: number | null, spaceId: number): number | null => {
        const id = i === null ? undefined : ids[i]
        return id !== undefined && this.tabs.get(id)?.spaceId === spaceId ? id : null
      }
      for (const sp of saved.spaces ?? []) {
        if (!known.has(sp.spaceId)) continue
        const layout = sp.layout ? remapLayout(sp.layout, (i) => inSpace(i, sp.spaceId)) : null
        if (sp.spaceId === this.activeSpaceId) this.setLayout(layout)
        else this.layouts.set(sp.spaceId, layout)
        const on = inSpace(sp.active, sp.spaceId)
        if (on !== null && sp.spaceId !== this.activeSpaceId) this.lastActive.set(sp.spaceId, on)
      }
      // closed on the board: open on it, and the tab view's tab is not loaded for a view nobody sees
      if (saved.canvas) {
        this.startCanvas = true
        // the board holds the pages off screen once its page has started (setOverlay); until then no page is put
        // up either, so the window never shows the tab view on its way to the board
        this.overlay = true
        this.setCanvasMode(true)
      }
      const own = ids.filter((id) => this.tabs.get(id)?.spaceId === this.activeSpaceId)
      const pick = ids[Math.min(saved.active, ids.length - 1)]
      this.activate(own.includes(pick) ? pick : (own[0] ?? this.create()))
      void this.preloadRecent()
    } else {
      this.create()
    }
  }

  /**
   * After a restart, load the tabs used most recently (Settings, preloadTabs) in the background, so they open at
   * once instead of loading when picked. Opening Panes comes first: it starts only once the window is up and the
   * page on screen has loaded, then takes one tab at a time with a pause between, each hidden and throttled. Once
   * loaded they rest like any hidden tab (caches given back, then frozen; see pickRests).
   */
  private async preloadRecent(): Promise<void> {
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms).unref())
    const until = async (done: () => boolean, maxMs: number): Promise<void> => {
      for (const end = Date.now() + maxMs; !done() && Date.now() < end;) await wait(250)
    }
    await wait(PRELOAD_START_MS)
    // nothing on screen still loading (a slow first page has the network and CPU to itself)
    await until(
      () =>
        this.onScreenIds().every((id) => {
          const t = this.tabs.get(id)
          const wc = t && liveContents(t)
          return !t || t.unloaded || !wc?.isLoading()
        }),
      15_000
    )
    const picks = pickPreloads(
      [...this.tabs].map(([id, t]) => ({
        id,
        usedAt: t.usedAt,
        web: /^https?:/i.test(t.pending?.url ?? ''),
        loaded: !t.pending
      })),
      this.deps.settings.get().preloadTabs
    )
    for (const id of picks) {
      const t = this.tabs.get(id)
      if (this.win.isDestroyed() || this.deps.settings.get().preloadTabs === 0) return
      if (!t?.pending) continue // opened (or closed) meanwhile
      t.lastShownAt = Date.now() // fresh: the memory saver does not unload it straight away
      this.ensureLoaded(id, t)
      await until(() => !t.awaiting, 10_000)
      await wait(PRELOAD_GAP_MS)
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
      pinned: boolean
      history: NavHistory | null
      shown: number
    }> = []
    let active = 0
    const at = new Map<number, number>() // tab id -> its place in `tabs`
    for (const [id, t] of this.tabs) {
      if (t.private) continue // private tabs are never written down
      const wc = liveContents(t)
      const url = t.pending?.url ?? wc?.getURL() ?? ''
      if (!/^(https?|file):/i.test(url)) continue
      if (id === this.activeId) active = tabs.length
      at.set(id, tabs.length)
      tabs.push({
        url,
        spaceId: t.spaceId,
        title: t.pending?.title ?? wc?.getTitle() ?? '',
        favicon: t.favicon,
        groupId: t.groupId,
        pinned: t.pinned,
        history: t.pending ? (t.pending.history ?? null) : wc ? historyOf(wc) : null,
        shown: t.usedAt
      })
    }
    const used = new Set(tabs.map((t) => t.groupId))
    const groups = [...this.groups.values()].filter((g) => used.has(g.id))
    const spaces = this.deps.spaces.list().map((sp) => {
      const here = sp.id === this.activeSpaceId
      const layout = here ? this.layout : (this.layouts.get(sp.id) ?? null)
      const on = here ? this.activeId : (this.lastActive.get(sp.id) ?? null)
      return {
        spaceId: sp.id,
        active: on === null ? null : (at.get(on) ?? null),
        layout: layout ? remapLayout(layout, (id) => at.get(id) ?? null) : null
      }
    })
    this.sessionStore.value = { tabs, active, groups, spaces, canvas: this.canvasMode }
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
  /** `hash` scrolls the page to a section (settings: ai). */
  openInternal(page: InternalPage, hash?: string): void {
    const base = internalUrl(page)
    const url = hash ? `${base}#${hash}` : base
    for (const [id, t] of this.tabs) {
      const wc = liveContents(t)
      if (t.spaceId === this.activeSpaceId && wc?.getURL().startsWith(base)) {
        if (hash)
          void wc
            .executeJavaScript(`location.hash = ${JSON.stringify(hash)}`)
            .catch(() => undefined)
        if (this.boardBrowsing()) return this.send('canvas:show-tab', id)
        return this.activate(id)
      }
    }
    this.create(url)
  }

  toggleBookmark(): void {
    const tab = this.pageTab()
    if (!tab) return
    const wc = tab.view.webContents
    if (!/^https?:/i.test(wc.getURL())) return
    this.deps.bookmarks.toggle(wc.getURL(), wc.getTitle(), tab.favicon)
    this.refresh()
  }

  find(text: string, forward = true): void {
    const wc = this.pageTab()?.view.webContents
    if (!wc) return
    if (!text) return this.stopFind()
    const isNew = text !== this.lastFind
    this.lastFind = text
    wc.findInPage(text, isNew ? {} : { forward, findNext: true })
  }

  stopFind(): void {
    this.lastFind = ''
    this.pageTab()?.view.webContents.stopFindInPage('clearSelection')
  }

  private zoom(delta: number | null, tab = this.pageTab()): void {
    const wc = tab?.view.webContents
    if (!wc) return
    const base = this.defaultZoom(tab?.spaceId)
    const next = delta === null ? base : wc.getZoomLevel() + delta
    const level = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
    wc.setZoomLevel(level)
    if (this.canvasMode && this.previewOpen) this.send('canvas:preview-key', 'zoom') // its bar shows the level
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

  /** Load an address or search in a given tab (the canvas preview's address field), without switching to it. */
  navigateTab(id: number, input: string): boolean {
    const tab = this.tabs.get(id)
    const url = resolveInput(input, this.deps.settings.searchUrl())
    if (!tab || !url) return false
    tab.hasUrl = true
    this.go(tab, url)
    this.refresh()
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
    this.go(tab, url)
    if (!this.canvasMode && !this.overlay) tab.view.webContents.focus()
    this.refresh()
  }

  back(): void {
    this.pageTab()?.view.webContents.navigationHistory.goBack()
  }
  forward(): void {
    this.pageTab()?.view.webContents.navigationHistory.goForward()
  }
  reload(hard = false): void {
    const tab = this.pageTab()
    if (!tab) return
    // Reloading an error page means trying the address that failed, not showing the error again.
    if (tab.failed) void tab.view.webContents.loadURL(tab.failed.url).catch(() => {})
    else if (hard) tab.view.webContents.reloadIgnoringCache()
    else tab.view.webContents.reload()
  }

  /** Back, forward or reload for one tab, whether or not it is the one on screen (the canvas preview's buttons). */
  navTab(id: number, what: 'back' | 'forward' | 'reload' | 'stop'): void {
    const tab = this.tabs.get(id)
    const wc = tab && liveContents(tab)
    if (!tab || !wc) return
    if (what === 'back') wc.navigationHistory.goBack()
    else if (what === 'forward') wc.navigationHistory.goForward()
    else if (what === 'stop') wc.stop()
    else if (tab.failed) void wc.loadURL(tab.failed.url).catch(() => {})
    else wc.reload()
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

  private viewSource(url = this.pageTab()?.view.webContents.getURL()): void {
    if (!url || !/^https?:/i.test(url)) return
    // on the board the source opens as a card, shown in the preview (the board stays up)
    const id = this.canvasMode ? this.create('', false) : this.create('')
    void this.tabs.get(id)?.view.webContents.loadURL(`view-source:${url}`)
    if (this.canvasMode) this.send('canvas:show-tab', id)
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

  /** Direct "Save as PDF" of the page on screen (the print dialog has its own; this is for the command bar). */
  private async savePdf(): Promise<void> {
    const wc = this.current()?.view.webContents
    if (!wc || !/^(https?|file):/i.test(wc.getURL())) return
    const { canceled, filePath } = await dialog.showSaveDialog(this.win, {
      defaultPath: pdfFileName(wc.getTitle(), wc.getURL()),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return
    writeFileSync(filePath, await wc.printToPDF({ printBackground: true }))
  }

  /** Close every tab of this space except the page on screen and pinned tabs. */
  closeOthers(): void {
    for (const id of this.own()) {
      if (id !== this.activeId && !this.tabs.get(id)?.pinned) this.close(id)
    }
  }

  /**
   * An action from the command bar that the window's own UI does not handle itself (see ACTIONS in shared/search.ts).
   * Returns false for an id it does not know.
   */
  runAction(id: string): boolean {
    const tab = this.current()
    const active = this.activeId
    const settings =
      (hash: string): (() => void) =>
      () =>
        this.openInternal('settings', hash)
    const page =
      (p: InternalPage): (() => void) =>
      () =>
        this.openInternal(p)
    const run: Record<string, () => unknown> = {
      'new-tab': () => this.newTabOrCard(),
      'new-private': () => this.newPrivateTab(),
      'new-tor': () => this.newTorTab(),
      reopen: () => this.reopenClosed(),
      'close-tab': () => active !== null && this.close(active),
      'close-others': () => this.closeOthers(),
      duplicate: () => active !== null && this.duplicate(active),
      pin: () => tab && active !== null && this.setPinned(active, !tab.pinned),
      mute: () => active !== null && this.toggleMute(active),
      reader: () => this.onReader?.(),
      'ask-selection': () => this.onAskSelection?.(),
      find: () => this.command('find'),
      bookmark: () => this.toggleBookmark(),
      reload: () => this.reload(),
      'hard-reload': () => this.reload(true),
      split: () => this.toggleSplit(),
      pip: () => this.togglePip(),
      fullscreen: () => this.win.setFullScreen(!this.win.isFullScreen()),
      'zoom-in': () => this.zoom(ZOOM_STEP),
      'zoom-out': () => this.zoom(-ZOOM_STEP),
      'zoom-reset': () => this.zoom(null),
      print: () => this.printPage(),
      'save-pdf': () => void this.savePdf(),
      'save-page': () => void this.savePage(),
      'open-file': () => void this.openFile(),
      'view-source': () => this.viewSource(),
      devtools: () => tab?.view.webContents.toggleDevTools(),
      'ai-setup': settings('ai'),
      passwords: page('passwords'),
      privacy: page('privacy'),
      software: page('software'),
      history: page('history'),
      bookmarks: page('bookmarks'),
      downloads: page('downloads'),
      settings: page('settings'),
      'settings-search': settings('search'),
      'settings-appearance': settings('appearance'),
      'settings-tabs': settings('tabs'),
      'settings-downloads': settings('downloads'),
      'settings-privacy': settings('privacy'),
      'settings-clear-data': settings('clear-data'),
      stack: () => this.command('open-stack'),
      grid: () => this.command('toggle-taskview'),
      'save-session': () => this.dumpTabs(),
      welcome: () => this.create('panes://welcome'),
      feedback: () => this.sendFeedback()
    }
    if (!Object.hasOwn(run, id)) return false
    run[id]()
    return true
  }

  private async openFile(): Promise<void> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.win, {
      properties: ['openFile']
    })
    if (!canceled && filePaths[0]) this.create(pathToFileURL(filePaths[0]).href)
  }
  stop(): void {
    const tab = this.current()
    if (tab?.torTarget) {
      // cancel what a Tor tab is holding for Tor: back to the blank tab it was
      tab.torTarget = null
      tab.hasUrl = false
      this.refresh()
    }
    tab?.view.webContents.stop()
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

  /** Tile the picked tabs side by side, in list order, beside the tab on screen when it is one of them. */
  splitMany(ids: number[]): void {
    const order = [...this.tabs.keys()].filter((id) => ids.includes(id))
    if (order.length < 2) return
    const anchor =
      this.activeId !== null && order.includes(this.activeId) ? this.activeId : order[0]
    let next = this.layoutWith(anchor)
    if (next.type === 'leaf') next = rowOf(order)
    else {
      let prev = anchor
      for (const id of order) {
        if (leaves(next).includes(id)) continue
        next = insertTab(next, prev, id, 'right')
        prev = id
      }
    }
    this.setLayout(next)
    this.activate(anchor)
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

  /**
   * Work out what the tab shows from what its frames report, held through short gaps (see holdCapture), and send
   * state only when that changes: the badge neither blinks when a call swaps devices nor re-renders on every report.
   */
  private showCapture(tab: Tab, was = tab.capture): void {
    if (tab.captureTimer) clearTimeout(tab.captureTimer)
    tab.captureTimer = null
    if (!liveContents(tab)) return
    const reported = mergeCapture(tab.captureFrames.values())
    const { hold, settleIn } = holdCapture(tab.captureHold, reported, Date.now())
    tab.captureHold = hold
    tab.capture = hold.shown
    if (settleIn !== null) tab.captureTimer = setTimeout(() => this.showCapture(tab), settleIn)
    if (!sameCapture(was, hold.shown)) this.refresh()
  }

  /**
   * Whether a tab is making sound, for its speaker. Chromium reports the sound itself, which drops out in every quiet
   * moment of a film or a call; a tab whose media is playing and was audible a moment ago stays marked through them.
   */
  /** Whether anything in the page really plays now (any frame's audio or video), set on `tab.media`. */
  /** Ask the page whether anything plays; `fallback` is taken when it cannot say (no answer, or a private page). */
  private checkPlaying(tab: Tab, wc: WebContents, fallback?: boolean): void {
    const take = (v: unknown): void => {
      const now = typeof v === 'boolean' ? v : fallback
      if (now === undefined || wc.isDestroyed() || tab.media === now) return
      tab.media = now
      this.refresh()
    }
    if (tab.private || tab.tor) return take(null) // no script into those pages for this
    // every frame: a video is often in one of its own (an embedded player); a frame that cannot answer counts as no
    const frames = wc.mainFrame.framesInSubtree.filter((f) => !f.isDestroyed())
    const ask = Promise.all(
      frames.map((f) =>
        f.executeJavaScript(PLAYING_SCRIPT, false).then(
          (v) => v === true,
          () => false
        )
      )
    ).then((all) => all.some(Boolean))
    void Promise.race([ask, new Promise((r) => setTimeout(() => r(null), 800))])
      .then(take)
      .catch(() => take(null))
  }

  private sounding(tab: Tab, wc: WebContents): boolean {
    return wc.isCurrentlyAudible() || (tab.media && Date.now() - tab.lastSoundAt < SOUND_HOLD_MS)
  }

  /** The speaker on a space: silence what is playing in it, or bring back what was silenced. */
  toggleSpaceMute(spaceId: number): void {
    const own = [...this.tabs.values()].filter((t) => t.spaceId === spaceId)
    const playing = own.filter((t) => {
      const wc = liveContents(t)
      return !!wc && this.sounding(t, wc) && !wc.audioMuted
    })
    for (const t of playing.length > 0 ? playing : own) {
      const wc = liveContents(t)
      if (wc && (playing.length > 0 || wc.audioMuted)) wc.audioMuted = playing.length > 0
    }
    this.refresh()
  }

  /** End what a page captures (the Stop sharing button): its tracks are stopped, which the page sees as the user ending it. */
  stopCapture(id: number, kinds: CaptureKind[]): void {
    const tab = this.tabs.get(id)
    const wc = tab && liveContents(tab)
    if (!wc) return
    for (const f of wc.mainFrame.framesInSubtree)
      void f.executeJavaScript(stopCaptureScript(kinds)).catch(() => {})
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
    const id = this.createLike(base, input)
    if (base !== null) {
      this.activate(base)
      this.splitWith(id)
    }
  }

  toggleSplit(): void {
    if (this.activeId === null) return
    if (this.visibleIds().length > 1) return this.unsplit(this.activeId)
    const active = this.activeId
    // the partner is the next tab of the same kind: a private tab is never paired with an ordinary one, nor a Tor tab
    // with a private one, since they would share a window but not their cookies or their route
    const ids = this.own()
    const same = ids.filter((id) => id === active || this.sameKind(id, active))
    const partner =
      same.length > 1 ? same[(same.indexOf(active) + 1) % same.length] : this.createLike(active, '')
    this.splitWith(partner)
  }

  /** Whether two tabs are alike in how private they are: ordinary, private, or private through Tor. */
  private sameKind(a: number, b: number): boolean {
    const x = this.tabs.get(a)
    const y = this.tabs.get(b)
    return !!x && !!y && x.private === y.private && x.tor === y.tor
  }

  /** A new tab, not shown, of the same kind as another: a private tab opens a private one, a Tor tab a Tor one. */
  private createLike(base: number | null, input: string): number {
    const from = base === null ? undefined : this.tabs.get(base)
    return this.create(input, false, this.activeSpaceId, undefined, !!from?.private, !!from?.tor)
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
  moveTab(id: number, index: number, groupId?: number | null): void {
    if (!this.tabs.has(id)) return
    // a tab in a tiled group moves with the group
    this.moveTogether(
      this.layout && leaves(this.layout).includes(id) ? leaves(this.layout) : [id],
      index,
      groupId,
      id
    )
  }

  /** Several tabs picked with Shift or Ctrl, dropped as one: they end up side by side at the drop, in list order. */
  moveTabs(ids: number[], index: number, groupId?: number | null): void {
    const own = this.own()
    const moving = own.filter((i) => ids.includes(i))
    if (moving.length > 0) this.moveTogether(moving, index, groupId, moving[0])
  }

  /** `lead` is the tab that was grabbed: whether it is pinned says which end of the list the drop belongs to. */
  private moveTogether(
    group: number[],
    index: number,
    groupId: number | null | undefined,
    lead: number
  ): void {
    const own = this.own()
    const rest = own.filter((i) => !group.includes(i))
    const removedBefore = group.filter((g) => own.indexOf(g) < index).length
    // Pinned tabs keep to the start of the list and the others to what follows it.
    const pinnedRest = rest.filter((i) => this.tabs.get(i)?.pinned).length
    const mine = !!this.tabs.get(lead)?.pinned
    const raw = Math.max(0, Math.min(rest.length, index - removedBefore))
    const at = mine ? Math.min(raw, pinnedRest) : Math.max(raw, pinnedRest)
    rest.splice(at, 0, ...group)
    this.reorder(rest)
    // A tab dropped between two members of a sidebar group joins it; one dragged away leaves it.
    for (const gid of group) {
      const tab = this.tabs.get(gid)
      if (!tab) continue
      // the drop says which group (or none) it ends up in; without that, its neighbours decide
      const wanted =
        groupId === undefined
          ? groupAfterMove(rest, this.groupOf, gid)
          : groupId !== null && this.groups.get(groupId)?.spaceId === tab.spaceId
            ? groupId
            : null
      tab.groupId = tab.pinned || !TAB_GROUPS ? null : wanted
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

  // ---- attention and notifications ----

  /** The person has this tab in front of them: on screen, nothing over it, in the focused window. */
  private looking(id: number): boolean {
    return (
      !this.win.isDestroyed() &&
      this.win.isFocused() &&
      !this.overlay &&
      this.visibleIds().includes(id)
    )
  }

  /**
   * Put the notification hook into the tab's page if its site may notify (the script checks, and does nothing
   * otherwise). Runs at dom-ready and again when the tab leaves the screen, which covers a site allowed after load.
   */
  private hookNotifications(tab: Tab): void {
    const wc = liveContents(tab)
    if (!wc || tab.unloaded || tab.notes || !/^https?:/i.test(wc.getURL())) return
    const notes = new Set<number>()
    tab.notes = notes // set before the answer, so a second call while this one runs does not hook twice
    void wc
      .executeJavaScript(NOTIFY_SCRIPT)
      .then((installed: unknown) => {
        if (installed !== true && tab.notes === notes) tab.notes = null
      })
      .catch(() => {
        if (tab.notes === notes) tab.notes = null
      })
  }

  private onNotifyReport(id: number, tab: Tab, message: string): void {
    const report = parseNotify(message)
    // Reports count only from a document the hook is in: anything else printing the prefix is ignored.
    if (!report || !tab.notes) return
    if (report.kind === 'click') {
      if (tab.notes.delete(report.id)) this.showFromNotification(id)
      return
    }
    tab.notes.add(report.id)
    if (tab.notes.size > 100) tab.notes.delete(tab.notes.values().next().value as number) // the oldest
    const before = tab.attention.ringUntil
    tab.attention = noteNotification(
      tab.attention,
      { title: report.title, body: report.body },
      this.looking(id),
      Date.now()
    )
    // a ringing call stops ringing on its own after a while: look again then
    if (tab.attention.ringUntil !== before) setTimeout(() => this.refresh(), RING_MS + 250)
    this.refresh()
  }

  /** The tab's page is in the board's preview (its own page or a split's other pane). */
  private inPreview(id: number): boolean {
    return this.canvasMode && (id === this.liveId || this.companions.has(id))
  }

  /** Have the page report Esc that it did not use itself (shared/previewEsc), so the preview can close on it. */
  private hookPreviewEsc(tab: Tab): void {
    const wc = liveContents(tab)
    if (wc && !tab.unloaded) void wc.executeJavaScript(ESC_SCRIPT).catch(() => undefined)
  }

  /** Esc in the preview's page that the page left alone: the preview closes, as Esc anywhere on the board would. */
  private onPreviewEsc(id: number): void {
    if (this.inPreview(id) && this.fullscreenId === null) this.send('canvas:preview-key', 'close')
  }

  /** A toast from this tab was clicked: bring the window up and show the tab, in whatever space it is in. */
  private showFromNotification(id: number): void {
    if (this.win.isDestroyed() || !this.tabs.has(id)) return
    if (this.win.isMinimized()) this.win.restore()
    this.win.show()
    this.win.focus()
    this.activate(id)
  }

  /** A click inside a split pane moves focus (and the address bar) to that pane's tab. */
  private focusPane(id: number): void {
    // a pane of the canvas preview (its page or a split's other page): page actions go to the one being used
    if (this.canvasMode && (id === this.liveId || this.companions.has(id))) {
      this.previewFocus = id
      return
    }
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
  /** The page views are shifted right and down by this much, at their own size (the window clips what runs off). */
  private slideX = 0
  private slideY = 0

  setSlide(x: number, y: number): void {
    const nx = Math.max(0, Math.min(600, Math.round(x)))
    const ny = Math.max(0, Math.min(200, Math.round(y)))
    if (nx === this.slideX && ny === this.slideY) return
    this.slideX = nx
    this.slideY = ny
    this.applyVisibility()
  }

  /** The normal session (cookies and cache of ordinary tabs), for fetches the canvas makes for the person. */
  normalSession(): Session {
    return this.session
  }

  /** A tab's page for reading it (never a private or Tor one: the caller asks `private` and refuses). */
  pageFor(id: number): {
    wc: WebContents
    url: string
    title: string
    private: boolean
    tor: boolean
    unloaded: boolean
    loading: boolean
  } | null {
    const t = this.tabs.get(id)
    const wc = t && liveContents(t)
    if (!t || !wc) return null
    return {
      wc,
      url: wc.getURL() || t.pending?.url || '',
      title: wc.getTitle(),
      private: t.private,
      tor: t.tor,
      unloaded: t.unloaded,
      loading: wc.isLoading()
    }
  }

  /**
   * Show one tab's real page inside the canvas, exactly at `rect` (window coordinates, scale 1, never transformed),
   * or none (null). There is only ever one: the canvas hides every other view. A tab that is not loaded yet loads.
   */
  setLive(id: number | null, rect?: Rect): void {
    const prevId = this.liveId
    const changed = prevId !== id
    const prepared = this.preparedId !== null ? this.tabs.get(this.preparedId) : undefined
    if (prepared && !prepared.warming) prepared.warmSize = null
    if (
      prepared &&
      this.preparedId !== id &&
      !this.streaming.has(this.preparedId!) &&
      !this.companions.has(this.preparedId!)
    ) {
      const pw = liveContents(prepared)
      if (pw) pw.setBackgroundThrottling(true) // was readied for the preview, but never shown in it
    }
    this.preparedId = null
    this.liveId = id
    this.liveRect = id !== null && rect ? rect : null
    // a video watched in the preview leaves it: its card takes the frame it was on
    if (prevId !== null && prevId !== id && this.canvasMode) this.grabStill(prevId)
    // a page still playing as it leaves the preview streams to its card from now on: hidden (and throttled) until the
    // board's next list, its video could be paused by Chromium and the card would show it stopped. The board's list
    // (setStreaming) has the last word a moment later.
    const leaving = prevId !== null && prevId !== id ? this.tabs.get(prevId) : undefined
    if (leaving?.media && this.canvasMode && !leaving.private && !leaving.tor && !leaving.unloaded)
      this.streaming.add(prevId!)
    if (
      prevId !== null &&
      prevId !== id &&
      !this.streaming.has(prevId) &&
      !this.companions.has(prevId)
    ) {
      const prevTab = this.tabs.get(prevId)
      const prevWc = prevTab && liveContents(prevTab)
      if (prevWc) prevWc.setBackgroundThrottling(true)
    }
    const t = id !== null ? this.tabs.get(id) : undefined
    // looked at in the preview (and the one just left was, until now): it counts as used, for pre-loading
    const prevTab = prevId !== null ? this.tabs.get(prevId) : undefined
    if (prevTab && changed) prevTab.usedAt = Date.now()
    if (t) t.usedAt = Date.now()
    if (id !== null && t) {
      this.ensureLoaded(id, t)
      t.awaiting = false
      if (changed && !t.unloaded && !this.win.isDestroyed()) {
        this.win.contentView.addChildView(t.view)
        this.onViewAdded?.()
      }
      const wc = liveContents(t)
      if (wc) wc.setBackgroundThrottling(false)
      if (changed) this.hookPreviewEsc(t) // Esc the page leaves alone closes the preview
    }
    this.applyVisibility()
    if (id !== null && t && !t.unloaded) {
      const wc = liveContents(t)
      if (wc) {
        wc.invalidate()
        if (changed) wc.focus()
      }
    }
  }

  /**
   * The other panes of a split, live beside the preview's page (window coordinates at rest, like setLive). Each loads
   * if need be, is brought over the board and kept painting; one no longer listed goes back to hidden and throttled.
   * Never private or Tor tabs.
   */
  setCompanions(list: Array<{ id: number; rect: Rect }>): void {
    const next = new Map<number, Rect>()
    for (const { id, rect } of list) {
      const t = this.tabs.get(id)
      if (!t || t.private || t.tor || id === this.liveId) continue
      next.set(id, rect)
    }
    for (const id of this.companions.keys()) {
      if (next.has(id) || id === this.liveId || this.streaming.has(id)) continue
      const t = this.tabs.get(id)
      const wc = t && liveContents(t)
      if (wc) wc.setBackgroundThrottling(true)
    }
    for (const [id, rect] of next) {
      const t = this.tabs.get(id)!
      const isNew = !this.companions.has(id)
      this.ensureLoaded(id, t)
      t.awaiting = false
      if (!t.unloaded && isNew && !this.win.isDestroyed()) {
        t.view.setBounds(rect)
        this.win.contentView.addChildView(t.view) // over the board, like the live page
        this.onViewAdded?.()
      }
      if (isNew) this.hookPreviewEsc(t)
      const wc = liveContents(t)
      if (wc) wc.setBackgroundThrottling(false)
    }
    this.companions = next
    this.applyVisibility()
  }

  /** Start loading a tab that is about to go live (an unloaded one would otherwise only start once shown). */
  prepareLive(id: number, rect?: Rect): void {
    const t = this.tabs.get(id)
    if (!t) return
    this.ensureLoaded(id, t)
    if (t.rest === 'frozen') this.thaw(t) // running again before it is shown, so its first frame is ready
    const wc = liveContents(t)
    if (wc) wc.setBackgroundThrottling(false)
    // painting out of sight, at the slot's size, while the preview grows and the page loads: shown complete
    if (id !== this.liveId) {
      this.preparedId = id
      t.warmSize = rect ?? t.warmSize
      this.applyVisibility()
    }
  }

  /** The canvas preview opened, changed card or closed (see pageTab). */
  setPreview(open: boolean, tab: number | null): void {
    this.previewOpen = open
    this.previewTab = open ? tab : null
  }

  /**
   * Load a tab that was let go (restored, or unloaded by the memory saver) and wait until its page has loaded, for
   * something to be done in it (play on its canvas card). Its page, or null if it did not come back in time.
   */
  async wake(id: number): Promise<WebContents | null> {
    const t = this.tabs.get(id)
    if (!t) return null
    this.ensureLoaded(id, t)
    const until = Date.now() + 10_000
    while (!this.liveReady(id) && Date.now() < until) await new Promise((r) => setTimeout(r, 100))
    return this.liveReady(id) ? liveContents(t) : null
  }

  /**
   * Whether the live tab's page is there to show (the canvas waits for that before it swaps the snapshot out): its
   * own document has loaded. Frames inside it (ads, embeds, chat widgets) may load for a long while yet; waiting for
   * them kept a finished page behind its picture for seconds.
   */
  liveReady(id: number): boolean {
    const t = this.tabs.get(id)
    const wc = t && liveContents(t)
    const u = wc ? wc.getURL() : ''
    return (
      !!t &&
      !t.unloaded &&
      !t.pending &&
      !t.navUrl &&
      !!wc &&
      !wc.isLoadingMainFrame() &&
      u !== '' &&
      u !== 'about:blank'
    )
  }

  /** Ctrl+T: a new tab, or on the canvas board a new card where the person asks for it. */
  private newTabOrCard(): void {
    if (this.canvasMode) {
      // the preview's live page is a native view over the board: the new-card popover would open under it, unseen
      if (this.previewOpen) this.send('canvas:preview-key', 'close')
      // the keyboard is in a page view when Ctrl+T comes from one: the popover's field can only take typing once the
      // window's own page has it
      if (!this.win.isDestroyed()) this.win.webContents.focus()
      this.send('canvas:new')
    } else this.create()
  }

  /**
   * Open an address the assistant was asked to open, and show it. On the canvas board the person stays on the
   * board: the tab opens behind it, and the board shows its card in the preview, live (one click pops it out).
   */
  openForAssistant(url: string): number {
    if (!this.canvasMode) return this.create(url)
    const id = this.create(url, false)
    this.send('canvas:show-tab', id)
    return id
  }

  /** Canvas mode opened or closed (see main/ai/canvas.ts). */
  setCanvasMode(open: boolean): void {
    if (this.canvasMode === open) return
    // the video being watched, as it is this moment: its card shows this frame until its stream comes in
    if (open && this.activeId !== null) this.grabStill(this.activeId)
    this.canvasMode = open
    if (!open) {
      this.startCanvas = false
      this.setLive(null) // its page goes back to being throttled, like any hidden one
      this.setCompanions([])
      this.setPreview(false, null)
      this.setStreaming([]) // the board's streams end with it: throttled and hidden again
    }
    this.refresh() // what counts as on screen changed: the tab view's tab loads again if it was let go
  }

  /**
   * The canvas cards showing their tab live (a tab stream into the board's own page). Those tabs keep painting and
   * are not throttled while hidden; the rest go back to normal. Never private or Tor tabs, whose cards show nothing.
   */
  setStreaming(ids: number[]): void {
    const next = new Set(
      ids.filter((id) => {
        const t = this.tabs.get(id)
        return this.canvasMode && !!t && !t.private && !t.tor && !t.unloaded
      })
    )
    for (const id of new Set([...this.streaming, ...next])) {
      const t = this.tabs.get(id)
      const wc = t && liveContents(t)
      if (
        wc &&
        id !== this.liveId &&
        !this.companions.has(id) &&
        next.has(id) !== this.streaming.has(id)
      )
        wc.setBackgroundThrottling(!next.has(id))
    }
    const started = [...next].filter((id) => !this.streaming.has(id))
    this.streaming = next
    this.applyVisibility()
    // a page that was hidden has no new frame to send until it repaints: ask for one, so the stream starts at once
    for (const id of started) {
      const t = this.tabs.get(id)
      const wc = t && liveContents(t)
      if (wc && !wc.isDestroyed()) wc.invalidate()
    }
  }

  /**
   * A stream id of a streaming tab's page, registered to the window's own interface: only that renderer can open it,
   * and only for 10 seconds.
   */
  streamSource(id: number): string | null {
    const t = this.tabs.get(id)
    const wc = t && liveContents(t)
    if (!wc || !this.streaming.has(id)) return null
    try {
      return wc.getMediaSourceId(this.win.webContents)
    } catch {
      return null
    }
  }

  /** Where the playing video is in a streaming tab's page (null: none, so its card keeps its picture). */
  /**
   * The frame a playing video is on now, cut to the video, sent to the board as that card's picture
   * (`canvas:still`), so a card never shows an old poster while its live stream starts. Taken as the tab leaves the
   * screen (capturePage still draws a page that has just been hidden). Only a page whose media plays.
   */
  private grabStill(id: number): void {
    const t = this.tabs.get(id)
    const wc = t && liveContents(t)
    if (!t || !wc || !t.media || t.private || t.tor || t.unloaded) return
    const b = t.view.getBounds()
    if (b.width < 50 || b.height < 50) return
    const size = { w: b.width, h: b.height }
    void this.videoRegion(id)
      .then(async (r) => {
        if (!r || wc.isDestroyed()) return
        const rect = {
          x: Math.max(0, Math.round(r.x * size.w)),
          y: Math.max(0, Math.round(r.y * size.h)),
          width: Math.round(r.w * size.w),
          height: Math.round(r.h * size.h)
        }
        if (rect.width < 40 || rect.height < 40) return
        const img = await wc.capturePage(rect)
        if (img.isEmpty() || wc.isDestroyed()) return
        const small = img.getSize().width > 640 ? img.resize({ width: 640, quality: 'good' }) : img
        this.send(
          'canvas:still',
          id,
          `data:image/jpeg;base64,${small.toJPEG(82).toString('base64')}`
        )
      })
      .catch(() => undefined)
  }

  async videoRegion(id: number): Promise<VideoRegion | null> {
    const t = this.tabs.get(id)
    const wc = t && liveContents(t)
    if (!t || !wc || t.private || t.tor) return null
    try {
      return videoRegion(
        await Promise.race([
          wc.executeJavaScript(VIDEO_RECT_SCRIPT),
          new Promise((res) => setTimeout(() => res(null), 1500))
        ])
      )
    } catch {
      return null
    }
  }

  /** Something is drawn over the page (the space editor, the command bar, a tab being dragged). */
  /** The guided tour opened or closed (see tourOpen). */
  setTourOpen(open: boolean): void {
    this.tourOpen = open
  }

  overlayOpen(): boolean {
    return this.overlay
  }

  /** The canvas board is up (it holds the overlay for as long as it is open). */
  inCanvas(): boolean {
    return this.canvasMode
  }

  /**
   * The board is up in a space browsed with the canvas (not one opened by hand over tabs): what the person opens
   * shows on the board instead of taking the window as a tab.
   */
  private boardBrowsing(spaceId = this.activeSpaceId): boolean {
    return (
      this.canvasMode &&
      spaceId === this.activeSpaceId &&
      browseWith(this.deps.settings.get().browseWith, this.deps.spaces.get(spaceId)) === 'canvas'
    )
  }

  async setOverlay(open: boolean, snapshot = true, sharp = false): Promise<void> {
    if (open && snapshot) {
      // The overlay shows the page as it was a moment ago, so a page on screen that changed since its last picture
      // (input, a load, sound, media playing) is taken again now, however recent that picture: an unchanged page
      // keeps it. The wait is capped (SNAPSHOT_TIMEOUT_MS); a capture that runs over updates the picture after.
      const stale = this.visibleIds().filter((id) => {
        const t = this.tabs.get(id)
        return (
          !!t &&
          (!t.thumb || (sharp && !t.thumbSharp) || !this.thumbFits(id, t) || t.dirty || t.media)
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
      // a live page that went full screen (a video) is no longer held to the slot: it takes the window
      const liveFull = this.canvasMode && id === this.liveId && this.fullscreenId === id
      const companion = this.canvasMode && !liveFull ? this.companions.get(id) : undefined
      const live =
        (this.canvasMode && id === this.liveId && this.liveRect !== null && !liveFull) ||
        !!companion
      // A tab streaming to its card must keep painting. Like captureHidden: shown with only its top-left pixels
      // inside the window's bottom-right corner, which its rounded corner leaves transparent, so none of it is seen.
      const streamed =
        this.canvasMode && !live && !liveFull && !tab.unloaded && this.streaming.has(id)
      const pageRect = streamed ? (this.rects[id] ?? this.activeRect()) : null
      // the live rect is the slot at rest: it rides the hover sidebar's and top bar's slide like any page view
      const liveAt = companion ?? (id === this.liveId ? this.liveRect : null)
      const rect =
        live && liveAt
          ? { ...liveAt, x: liveAt.x + this.slideX, y: liveAt.y + this.slideY }
          : streamed
            ? {
                x: w - 3,
                y: h - 3,
                width: Math.max(800, pageRect?.width ?? w),
                height: Math.max(600, pageRect?.height ?? h)
              }
            : placed && this.overlay && !liveFull
              ? { ...placed, x: PARKED_X }
              : placed && this.fullscreenId === null
                ? { ...placed, x: placed.x + this.slideX, y: placed.y + this.slideY }
                : placed
      const wanted =
        rect !== null &&
        !this.isBlank(tab) &&
        !tab.torTarget &&
        !this.settling &&
        (live || liveFull || streamed || !this.canvasMode)
      const show = wanted && !tab.awaiting
      // A full-screen page has no window edge to be rounded against.
      const flat = this.fullscreenId === id
      if (flat !== tab.flat && !tab.unloaded) {
        tab.flat = flat
        tab.view.setBorderRadius(flat ? 0 : VIEW_RADIUS)
      }
      // Painting out of sight before it is shown, at its real size, all but a corner pixel outside: a page coming back
      // (see warm), one loading for its place (see load: revealed once it has drawn), one the preview is about to show.
      const aside =
        tab.warming ||
        (tab.awaiting && (wanted || (!this.canvasMode && shown.includes(id)))) || // (its slot may not be known yet)
        (this.canvasMode && id === this.preparedId && id !== this.liveId)
      if (aside && !tab.unloaded) {
        const size = tab.warmSize ?? rect ?? this.rects[id] ?? this.activeRect()
        tab.view.setBounds({
          x: w - 3,
          y: h - 3,
          width: Math.max(320, size?.width ?? w),
          height: Math.max(240, size?.height ?? h)
        })
        tab.view.setVisible(true)
        continue
      }
      if (show) tab.view.setBounds(rect)
      tab.view.setVisible(show)
    }
  }

  // ---- events ----

  private wire(id: number, tab: Tab): void {
    const wc = tab.view.webContents
    const refresh = (): void => this.refresh()
    wc.on('did-navigate', (_e, url) => {
      // a new view commits about:blank first: that is not the page that was asked for
      if (url !== 'about:blank') tab.navUrl = null
    })

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
    wc.on('did-create-window', (child, details) => {
      // A pop-up (Google sign-in, for one) is on its way to an address already: give it the identity that address wants
      // without loading anything, and keep it matched as it moves on.
      const ids = { plain: tabSession.getUserAgent(), chrome: this.deps.chromeUa }
      void applyIdentity(child.webContents, ids, details.url, false)
      child.webContents.on('did-start-navigation', (d) => {
        if (d.isMainFrame && !d.isSameDocument) followIdentity(child.webContents, ids, d.url)
      })
    })
    wc.on('did-start-loading', refresh)
    wc.on('dom-ready', () => {
      this.applyDarkening() // covers tabs created or restored after the theme last changed
      this.applyZoom()
      tab.boostKey = null // a new document starts without the old sheet
      void this.applyBoost(tab)
      this.hookNotifications(tab)
      if (this.inPreview(id)) this.hookPreviewEsc(tab) // a page navigated to inside the preview
    })
    wc.on('audio-state-changed', () => {
      tab.dirty = true
      tab.lastSoundAt = Date.now()
      refresh()
      // the speaker stays while the media plays on through a quiet stretch; when that grace runs out it goes
      setTimeout(refresh, SOUND_HOLD_MS + 250)
    })
    // these come per media element (an ad or a hover preview pausing says nothing of the main video): the page is
    // asked what plays after each, and that is what play/pause buttons show
    wc.on('media-started-playing', () => {
      tab.media = true
      refresh()
      this.checkPlaying(tab, wc)
    })
    // not "stopped" at once: the page's answer decides, so a card's stream does not stop and start again when an
    // ad or a hover preview pauses beside the main video. A page that cannot be asked takes the event's word.
    wc.on('media-paused', () => this.checkPlaying(tab, wc, false))
    wc.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) tab.media = false
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
      // A new document has no notification hook; it goes in at dom-ready. Not on starting to navigate: a navigation
      // that turns into a download leaves the old document, hook and all, in place.
      tab.notes = null
      if (!wc.getURL().startsWith('panes://error')) tab.failed = null
      tab.keyLock = false
      if (!tab.private) this.deps.history.add(wc.getURL(), wc.getTitle())
      this.lastFind = ''
      refresh()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) tab.dirty = true // an app that changes page without loading one (Gmail, YouTube)
      if (isMainFrame && !tab.private) this.deps.history.add(url, wc.getTitle())
      refresh()
    })
    wc.on('page-title-updated', (_e, title) => {
      tab.dirty = true
      if (!tab.private) this.deps.history.updateMeta(wc.getURL(), { title })
      tab.attention = noteTitle(tab.attention, title, this.looking(id))
      refresh()
    })
    wc.on('found-in-page', (_e, r) => {
      // the page find runs in: the active tab, or the canvas preview's
      if (this.pageTab() === tab) {
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
        onBoard: this.canvasMode,
        openSplit: (u) => {
          // on the board: beside the page in the preview (it then shows the two side by side), not the tab view's
          const base = this.canvasMode ? id : this.activeId
          const nid = this.create(u, false)
          if (base !== null) {
            this.activate(base)
            this.splitWith(nid)
          }
        },
        pip: () => this.togglePip(),
        print: () => this.printPage(),
        // chat never reads a private or Tor tab, so there is nothing to ask about there
        // AI turned off: no "Ask AI" in the page's menu (it would open a conversation that cannot answer)
        askAi:
          tab.private || tab.tor || !this.deps.settings.get().ai.enabled
            ? null
            : (text) => this.askAi(text),
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
      // the canvas board has every view hidden: a page that loads there is pictured off-screen for its card
      if (this.canvasMode) {
        if (tab.thumbTimer) clearTimeout(tab.thumbTimer)
        tab.thumbTimer = setTimeout(() => void this.captureForCanvas(id), 500)
      }
    })
    wc.on('did-finish-load', () => {
      if (tab.failed) return
      this.onPageLoaded?.({
        id,
        url: wc.getURL(),
        title: wc.getTitle(),
        private: tab.private,
        tor: tab.tor,
        wc
      })
    })
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      followIdentity(wc, this.identities(tab), details.url)
      tab.favicon = null
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
    // Capture is reported per frame (a call widget can be an iframe). A page's capture ends with its document,
    // so it is cleared when a new one commits (not when a navigation merely starts: a download or a 204 never
    // replaces the page, which goes on capturing), and a frame's when that frame is replaced or removed.
    wc.on('console-message', (e) => {
      const state = parseCapture(e.message)
      if (!state) return
      const live = new Set(wc.mainFrame.framesInSubtree.map((f) => f.frameTreeNodeId))
      for (const node of tab.captureFrames.keys()) {
        if (!live.has(node)) tab.captureFrames.delete(node)
      }
      tab.captureFrames.set(e.frame.frameTreeNodeId, state)
      this.showCapture(tab)
    })
    wc.on('did-frame-navigate', (_e, _url, _code, _status, isMainFrame, processId, routingId) => {
      const was = tab.capture
      if (isMainFrame) {
        tab.captureFrames.clear()
        tab.captureHold = NO_HOLD // a new page has captured nothing: no hold carries over to it
      } else {
        const node = webFrameMain.fromId(processId, routingId)?.frameTreeNodeId
        if (node === undefined || !tab.captureFrames.delete(node)) return
      }
      this.showCapture(tab, was)
    })
    wc.on('console-message', (e) => {
      if (isPreviewEsc(e.message)) this.onPreviewEsc(id)
      else this.onNotifyReport(id, tab, e.message)
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      // A page swapping one icon for another (not its first icon after loading) is drawing a badge into it.
      const next = favicons[0] ?? null
      if (tab.favicon && next && next !== tab.favicon && !wc.isLoading()) {
        tab.attention = noteFavicon(tab.attention, this.looking(id))
      }
      tab.favicon = next
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
      // The built-in PDF viewer (and anything else in an extension frame) uses Ctrl+wheel to zoom: there the
      // stack opens on Shift+wheel instead (and Ctrl+Tab still works).
      const inExtension = wc.mainFrame.framesInSubtree.some((f) =>
        f.url.startsWith('chrome-extension://')
      )
      const wanted = inExtension ? ['shift'] : ['control', 'ctrl']
      if (!ev.modifiers?.some((m) => wanted.includes(m))) return
      if (!inExtension && !this.ctrlHeld()) return // a pinch, not Ctrl and scroll
      this.shiftStack = inExtension
      const { wheelTicksY = 0, deltaY = 0 } = ev as MouseWheelInputEvent
      // Chromium's wheel delta is positive for scroll-up; the renderer expects DOM units (down is positive).
      this.send('ui:stack-wheel', wheelTicksY !== 0 ? -wheelTicksY * 100 : -deltaY)
    })
    wc.setWindowOpenHandler(({ url, features, disposition }) => {
      // Sign-in flows (Google, Figma, ...) open a popup and message the page that opened it, so a
      // real popup window must stay linked to its opener. Ordinary links still become tabs. An empty page
      // (about:blank) is one a script means to write into or navigate itself, so it too must keep its opener:
      // as a separate tab it would be cut off from the page that wanted it (and was once searched for).
      if (
        disposition === 'new-window' ||
        url === 'about:blank' ||
        url === '' ||
        /\b(width|height|popup)\b/i.test(features)
      ) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: this.popupOptions(features, tabSession)
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
    if (this.externalScheme(url)) {
      if (url.toLowerCase().startsWith('mailto:')) return this.openMailto(url)
      return void shell.openExternal(url)
    }
    const opener = from === undefined ? undefined : this.tabs.get(from)
    // on the canvas board the page opens behind it, as a card the board draws an arrow to, shown in the preview
    const onBoard = this.canvasMode && from !== undefined && !opener?.private && !opener?.tor
    const id = opener?.tor
      ? this.create(url, true, this.activeSpaceId, undefined, true, true)
      : opener?.private
        ? this.newPrivateTab(url)
        : onBoard
          ? this.create(url, false)
          : this.create(url)
    if (onBoard) this.send('canvas:link-opened', from, id)
    // A link opened from a tab in a group joins that group, at its bottom.
    const group = from === undefined ? null : (this.tabs.get(from)?.groupId ?? null)
    if (group !== null) this.addToGroup(id, group)
  }

  /** Browser shortcuts. Registered on every tab and the UI window so they work wherever focus is. */
  handleKey(event: Event, input: Input): void {
    // the real Ctrl key, as the keyboard says it (see ctrlHeld)
    if (input.type === 'keyDown' && (input.control || input.meta)) this.ctrlAt = Date.now()
    else if (input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Meta'))
      this.ctrlAt = 0
    if (this.trackEscHold(input)) return // the page still sees the key; only the exit is timed
    if (input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Meta')) {
      this.send('ui:stack-release')
      return
    }
    // a stack opened with Shift+wheel (over a PDF) is let go of with Shift
    if (input.type === 'keyUp' && input.key === 'Shift' && this.shiftStack) {
      this.shiftStack = false
      this.send('ui:stack-release')
      return
    }
    if (input.type !== 'keyDown') return
    const mod = input.control || input.meta
    const k = input.key.toLowerCase()
    // the tour asks for a shortcut and must see it, without the feature running under it (Ctrl+Shift+K would swap
    // the window for the board and end the tour): every modified key goes to the tour alone while it is up
    // (Alt+F4 still closes the window)
    if (this.tourOpen && (mod || input.alt || /^f\d+$/.test(k)) && !(input.alt && k === 'f4')) {
      this.send('ui:tour-key', {
        key: input.key,
        ctrlKey: !!input.control,
        metaKey: !!input.meta,
        shiftKey: !!input.shift,
        altKey: !!input.alt
      })
      event.preventDefault()
      return
    }
    let handled = true

    if (mod && !input.alt && !input.shift) {
      if (k === 't') this.newTabOrCard()
      else if (k === 'w' && this.canvasMode) {
        // on the board: the page in the preview closes (and the preview with it); with none open the board takes the
        // key (it closes the selected card's tab). Never the tab view's tab, which is not on screen.
        const id = this.previewOpen ? (this.pageTab() ? this.pageTabId() : null) : null
        if (id !== null) {
          // the preview's own page: the preview closes with it; a split's other pane: only that pane goes
          if (!this.companions.has(id)) this.send('canvas:preview-key', 'close')
          this.close(id)
        } else handled = false
      } else if (k === 'w' && this.activeId !== null) this.close(this.activeId)
      else if (k === 'f4' && this.activeId !== null) this.close(this.activeId)
      else if (k === 'l') this.command('focus-address')
      else if (k === 'r') this.reload()
      else if (k === 'f5') this.reload(true)
      else if (k === 'u') this.viewSource()
      else if (k === 'b') this.command('toggle-sidebar')
      else if (k === '\\') this.toggleSplit()
      else if (k === 'f') this.command('find')
      // on the board Ctrl+D duplicates the selected cards (the board's own key handler)
      else if (k === 'd' && !this.canvasMode) this.toggleBookmark()
      else if (k === 'h') this.openInternal('history')
      else if (k === 'j') this.openInternal('downloads')
      else if (k === ',') this.openInternal('settings')
      else if (k === 'p') this.onPrint?.(false)
      else if (k === 'm') this.runAction('mute')
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
      else if (k === 'f12' && this.deps.settings.get().debugPanes)
        this.win.webContents.openDevTools({ mode: 'detach' }) // Panes' own interface (Settings, debugging)
      else if (k === 'r') this.reload(true)
      else if (k === 'n') this.newPrivateTab()
      else if (k === 'delete') this.openInternal('settings', 'clear-data')
      else if (k === 'b') this.openInternal('bookmarks')
      else if (k === 'j' || k === 'c') this.current()?.view.webContents.toggleDevTools()
      else if (k === 'pagedown') this.moveActive(1)
      else if (k === 'pageup') this.moveActive(-1)
      else if (k === 'tab') this.send('ui:stack-wheel', -STACK_STEP)
      else if (k === 'a') this.command('toggle-taskview')
      else if (k === 'p') this.onPrint?.(true)
      else if (k === 'e') this.runAction('reader')
      else if (k === 'y') this.runAction('ask-selection')
      else if (k === 'k') this.command('toggle-canvas')
      else if (k === 'l') this.command('toggle-chat')
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

  /** `leaving`: it is going off screen this moment (a just-hidden page can still be captured). */
  private async snapshot(id: number, sharp = false, leaving = false): Promise<void> {
    const tab = this.tabs.get(id)
    if (!tab || this.overlay || (!leaving && !this.visibleIds().includes(id)) || this.isBlank(tab))
      return
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
      this.send('tabs:thumb', id, tab.thumb)
    } catch {
      // tab closed or view torn down mid-capture
    }
  }

  // ---- canvas (main/ai/canvas.ts): pictures of tabs that are not on screen ----

  /** The tabs of a space with what the canvas needs to know about their pictures. */
  canvasTabs(spaceId: number): Array<{
    id: number
    url: string
    title: string
    private: boolean
    tor: boolean
    unloaded: boolean
    thumbAt: number
    hasThumb: boolean
  }> {
    const out: ReturnType<TabManager['canvasTabs']> = []
    for (const [id, t] of this.tabs) {
      if (t.spaceId !== spaceId) continue
      const wc = liveContents(t)
      out.push({
        id,
        url: t.pending?.url ?? wc?.getURL() ?? t.firstUrl,
        title: t.pending?.title || wc?.getTitle() || '',
        private: t.private,
        tor: t.tor,
        unloaded: t.unloaded,
        thumbAt: t.thumbAt,
        hasThumb: !!t.thumb
      })
    }
    return out
  }

  /** A fresh picture of a loaded tab that may be hidden. Never for a private or Tor tab. */
  /** A page that loaded while the canvas is up: its picture, tried a few times (the first capture can fail). */
  private async captureForCanvas(id: number): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const before = this.tabs.get(id)?.thumbAt
      await this.captureHidden(id)
      const t = this.tabs.get(id)
      if (!t || !this.canvasMode || t.thumbAt !== before) return
      await new Promise((res) => setTimeout(res, 500 + i * 500))
    }
  }

  async captureHidden(id: number): Promise<void> {
    const tab = this.tabs.get(id)
    const wc = tab && liveContents(tab)
    if (!tab || !wc || tab.private || tab.tor || tab.unloaded || tab.failed || this.isBlank(tab)) {
      return
    }
    try {
      // A hidden view draws nothing, and one that was never on screen (opened while the canvas is up) has no size
      // either. Off the window it counts as hidden too, so it is shown with only its top-left pixel inside the
      // window's bottom-right corner, which its own rounded corner leaves transparent: nothing shows, yet it paints.
      const hidden = !tab.view.getVisible()
      if (hidden) {
        const b = tab.view.getBounds()
        const [w, h] = this.win.getContentSize()
        const r = this.activeRect()
        tab.view.setBounds({
          x: w - 3,
          y: h - 3,
          width: b.width >= 64 ? b.width : Math.max(800, r?.width ?? w),
          height: b.height >= 64 ? b.height : Math.max(600, r?.height ?? h)
        })
        tab.view.setVisible(true)
        wc.invalidate()
        await new Promise((res) => setTimeout(res, 400))
      }
      let img: Electron.NativeImage | null
      try {
        // a page that never draws must not hold the card up: give up after a while (the card keeps its words)
        img = await Promise.race([
          wc.capturePage(undefined, { stayHidden: true }),
          new Promise<null>((res) => setTimeout(() => res(null), 2500))
        ])
      } finally {
        // back out of sight unless it became the page on screen (or the live page) meanwhile
        if (hidden && this.tabs.has(id)) this.applyVisibility()
      }
      if (!img || img.isEmpty() || !this.tabs.has(id)) return
      const jpeg = img.resize({ width: CANVAS_THUMB_WIDTH, quality: 'good' }).toJPEG(70)
      tab.thumb = 'data:image/jpeg;base64,' + jpeg.toString('base64')
      tab.thumbSharp = false
      tab.thumbSize = { w: 0, h: 0 }
      tab.thumbAt = Date.now()
      this.send('tabs:thumb', id, tab.thumb)
    } catch {
      // closed mid-capture
    }
  }

  /** The picture a normal tab has (null for private and Tor tabs, which are never kept or shown elsewhere). */
  thumbOf(id: number): string | null {
    const t = this.tabs.get(id)
    return t && !t.private && !t.tor ? t.thumb || null : null
  }

  /** Give a tab with no picture one from the disk cache (an unloaded tab after a restart). */
  /** A picture of the page as it is right now (the canvas preview's, as it closes): the tab's picture from now on. */
  takeThumb(id: number, dataUrl: string): void {
    const t = this.tabs.get(id)
    if (!t || t.private || t.tor) return
    t.thumb = dataUrl
    t.thumbAt = Date.now()
    t.dirty = false
    this.send('tabs:thumb', id, dataUrl)
  }

  seedThumb(id: number, dataUrl: string): void {
    const t = this.tabs.get(id)
    if (!t || t.private || t.tor || t.thumb) return
    t.thumb = dataUrl
    this.send('tabs:thumb', id, dataUrl)
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

  /**
   * Bring every tab in line with the current theme and the setting. Panes' own pages are left alone: they are drawn
   * for the scheme already, and Chromium's darkening would wipe out their light-on-dark surfaces and buttons.
   */
  applyDarkening(): void {
    const on = this.deps.settings.get().darkenSites && nativeTheme.shouldUseDarkColors
    for (const t of this.tabs.values()) {
      const own = liveContents(t)?.getURL().startsWith('panes://') ?? false
      this.setDarkening(t, on && !own)
    }
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

  /** Pin a tab (it moves to the end of the pinned ones) or unpin it (to just after them). */
  setPinned(id: number, pinned: boolean): void {
    const tab = this.tabs.get(id)
    if (!tab || tab.pinned === pinned) return
    tab.pinned = pinned
    if (pinned) tab.groupId = null // a pinned tab stands alone
    const own = this.own().filter((i) => i !== id)
    const pinnedCount = own.filter((i) => this.tabs.get(i)?.pinned).length
    own.splice(pinnedCount, 0, id)
    this.reorder(own)
    this.refresh()
    this.persistSession()
  }

  /** Save what is open in this space as a session; `close` also closes those tabs (a quick clear-out). */
  dumpTabs(close = false): TabDump | null {
    const open = this.state().tabs.filter((t) => !t.private)
    const dump = this.deps.dumps.add(dumpableTabs(open))
    if (dump && close) {
      const saved = new Set(dump.tabs.map((t) => t.url))
      for (const t of open) if (saved.has(t.url)) this.close(t.id)
    }
    const n = dump?.tabs.length ?? 0
    this.say(
      dump
        ? `Saved ${n} ${n === 1 ? 'tab' : 'tabs'} as "${dump.name}"${close ? ' and closed them' : ''}`
        : 'There are no web pages open to save'
    )
    return dump
  }

  /**
   * Open pages from a list (the history page's selection): the first becomes the tab you are on, and the rest wait
   * unloaded, with their title and icon, until they are visited, so opening fifty pages does not start fifty
   * processes. The page is not trusted: only web addresses, once each, and a capped number get through.
   */
  openMany(items: OpenItem[]): number {
    const list = bulkOpenList(items)
    list.forEach((it, i) => {
      const lazy =
        i === 0
          ? undefined
          : {
              title: typeof it.title === 'string' ? it.title.slice(0, 500) : '',
              favicon: typeof it.favicon === 'string' ? it.favicon : null
            }
      this.create(it.url, i === 0, this.activeSpaceId, lazy)
    })
    return list.length
  }

  /**
   * Open another browser's open tabs (an import) in the active space: each one unloaded, so a hundred tabs
   * start a hundred titles and not a hundred pages, all gathered into one group named after the browser. The
   * person is not moved onto them (the welcome page keeps the focus), so none is activated. A page already open
   * in the space is not opened again, and an import run twice fills the group of that name rather than making a
   * second one. How many tabs opened.
   */
  addImportedTabs(groupName: string, imported: { url: string; title: string }[]): number {
    const open = new Set<string>()
    for (const t of this.tabs.values()) {
      if (t.spaceId !== this.activeSpaceId) continue
      const wc = t.unloaded ? null : liveContents(t)
      const url = t.pending?.url || wc?.getURL() || t.firstUrl
      if (url) open.add(url)
    }
    const ids: number[] = []
    for (const t of imported) {
      if (typeof t.url !== 'string' || open.has(t.url)) continue
      open.add(t.url)
      const title = typeof t.title === 'string' ? t.title.slice(0, 500) : ''
      ids.push(this.create(t.url, false, this.activeSpaceId, { title, favicon: null }))
    }
    if (!ids.length) return 0
    const existing = [...this.groups.values()].find(
      (g) => g.spaceId === this.activeSpaceId && g.name === groupName
    )
    let groupId = existing?.id ?? null
    if (groupId === null) {
      this.createGroup(ids[0], groupName)
      groupId = this.tabs.get(ids[0])?.groupId ?? null
    }
    if (groupId !== null)
      for (const tid of ids)
        if (this.tabs.get(tid)?.groupId !== groupId) this.addToGroup(tid, groupId)
    return ids.length
  }

  /** Open a saved session as a new group of tabs, named after it. */
  openDump(id: number): void {
    const dump = this.deps.dumps.get(id)
    if (!dump || dump.tabs.length === 0) return
    const ids = dump.tabs.map((t, i) => this.create(t.url, i === 0))
    this.createGroup(ids[0], dump.name)
    for (const tid of ids.slice(1)) this.addToGroup(tid, this.tabs.get(ids[0])?.groupId ?? -1)
  }

  /** The group a tab is in, if any. */
  groupIdOf(tabId: number): number | null {
    return this.tabs.get(tabId)?.groupId ?? null
  }

  createGroup(tabId: number, name = ''): void {
    const tab = this.tabs.get(tabId)
    if (!TAB_GROUPS || !tab || tab.pinned) return
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
    if (
      !TAB_GROUPS ||
      !tab ||
      tab.pinned ||
      !group ||
      group.spaceId !== tab.spaceId ||
      tab.groupId === groupId
    )
      return
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

  tabMenu(id: number, picked: number[] = []): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (picked.length > 1 && picked.includes(id)) {
      // several tabs picked with Shift or Ctrl: the actions that make sense for all of them
      Menu.buildFromTemplate([
        { label: `Add ${picked.length} tabs to split view`, click: () => this.splitMany(picked) },
        {
          label: `Duplicate ${picked.length} tabs`,
          click: () => picked.forEach((t) => this.duplicate(t))
        },
        { type: 'separator' },
        { label: `Close ${picked.length} tabs`, click: () => picked.forEach((t) => this.close(t)) }
      ]).popup({ window: this.win })
      return
    }
    const others = [...this.groups.values()].filter(
      (g) => g.spaceId === tab.spaceId && g.id !== tab.groupId
    )
    const items: MenuItemConstructorOptions[] = [
      {
        label: tab.pinned ? 'Unpin tab' : 'Pin tab',
        click: () => this.setPinned(id, !tab.pinned)
      },
      { label: 'Duplicate tab', click: () => this.duplicate(id) },
      ...(TAB_GROUPS
        ? [
            { type: 'separator' } as MenuItemConstructorOptions,
            {
              label: 'Add to new group',
              click: () => this.createGroup(id),
              enabled: !tab.pinned
            }
          ]
        : [])
    ]
    const saveItems: MenuItemConstructorOptions[] = [
      { label: 'Save all tabs as a session', click: () => this.dumpTabs() },
      { label: 'Save all tabs and close them', click: () => this.dumpTabs(true) }
    ]
    if (TAB_GROUPS && others.length > 0) {
      items.push({
        label: 'Add to group',
        submenu: others.map((g) => ({
          label: g.name || 'Unnamed group',
          click: () => this.addToGroup(id, g.id)
        }))
      })
    }
    if (TAB_GROUPS && tab.groupId !== null) {
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
      { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => this.newTabOrCard() },
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
      { label: 'Print...', accelerator: 'CmdOrCtrl+P', click: () => this.printPage() },
      { label: 'Save all tabs as a session', click: () => this.dumpTabs() },
      { label: 'Save page as...', click: () => void this.savePage() },
      { label: 'Open file...', click: () => void this.openFile() },
      { label: 'View page source', accelerator: 'CmdOrCtrl+U', click: () => this.viewSource() },
      { type: 'separator' },
      {
        label: 'Canvas',
        accelerator: 'CmdOrCtrl+Shift+K',
        click: () => this.command('toggle-canvas')
      },
      { label: 'Chat', accelerator: 'CmdOrCtrl+Shift+L', click: () => this.command('toggle-chat') },
      { type: 'separator' },
      { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => this.openInternal('settings') },
      { label: 'AI settings', click: () => this.openInternal('settings', 'ai') },
      page('About and updates', 'software'),
      { label: 'Welcome tour', click: () => this.create('panes://welcome') },
      { label: 'Send feedback', click: () => this.sendFeedback() }
    ]).popup({ window: this.win, x, y })
  }

  /**
   * The usual things to do with a page, for one tab wherever it is shown (the canvas preview): a native menu, so it
   * draws over the live page. What the board does itself (pop out, ask) comes back as the picked item's id.
   */
  pageMenu(id: number, x?: number, y?: number, live?: boolean): Promise<PageMenuPick | null> {
    const tab = this.tabs.get(id)
    const wc = tab && liveContents(tab)
    if (!tab || !wc) return Promise.resolve(null)
    const url = wc.getURL()
    const priv = tab.private || tab.tor
    const caps = pageCaps(url, priv)
    const shown = live === true
    const sep: MenuItemConstructorOptions = { type: 'separator' }
    const when = (
      ok: boolean,
      ...items: MenuItemConstructorOptions[]
    ): MenuItemConstructorOptions[] => (ok ? items : [])
    return new Promise((resolve) => {
      // what the board does itself comes back at once: on some platforms the click lands after the close callback
      const pick = (what: PageMenuPick) => (): void => resolve(what)
      const items: MenuItemConstructorOptions[] = [
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          enabled: wc.navigationHistory.canGoBack(),
          click: () => wc.navigationHistory.goBack()
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          enabled: wc.navigationHistory.canGoForward(),
          click: () => wc.navigationHistory.goForward()
        },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => this.navTab(id, 'reload') },
        sep,
        ...when(caps.bookmark, {
          label: this.deps.bookmarks.has(url) ? 'Remove bookmark' : 'Bookmark this page',
          accelerator: 'CmdOrCtrl+D',
          click: () => {
            this.deps.bookmarks.toggle(url, wc.getTitle(), tab.favicon)
            this.refresh()
          }
        }),
        ...when(caps.copy, { label: 'Copy link', click: () => clipboard.writeText(url) }),
        ...when(shown, {
          label: 'Find in page...',
          accelerator: 'CmdOrCtrl+F',
          click: pick('find')
        }),
        ...when(shown, {
          label: `Zoom (${zoomPercent(wc.getZoomLevel())}%)`,
          submenu: [
            {
              label: 'Zoom in',
              accelerator: 'CmdOrCtrl+=',
              click: () => this.zoom(ZOOM_STEP, tab)
            },
            {
              label: 'Zoom out',
              accelerator: 'CmdOrCtrl+-',
              click: () => this.zoom(-ZOOM_STEP, tab)
            },
            { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => this.zoom(null, tab) }
          ]
        }),
        sep,
        ...when(caps.site, { label: 'Site settings...', click: pick('site') }),
        { label: wc.audioMuted ? 'Unmute tab' : 'Mute tab', click: () => this.toggleMute(id) },
        sep,
        ...when(live !== undefined, {
          label: shown ? 'Show as reader' : 'Show the live page',
          click: pick(shown ? 'reader' : 'live')
        }),
        { label: 'Pop out as a tab', click: pick('popout') },
        ...when(!priv && this.deps.settings.get().ai.enabled, {
          label: 'Ask about this page',
          click: pick('ask')
        }),
        ...when(caps.source, sep, {
          label: 'View page source',
          accelerator: 'CmdOrCtrl+U',
          click: () => this.viewSource(url)
        }),
        sep,
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => this.openInternal('settings')
        },
        { label: 'Close preview', accelerator: 'Esc', click: pick('close') }
      ]
      Menu.buildFromTemplate(items).popup({
        window: this.win,
        ...(x !== undefined && y !== undefined ? { x: Math.round(x), y: Math.round(y) } : {}),
        callback: () => setTimeout(() => resolve(null), 0)
      })
    })
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
    const visible = this.onScreenIds()
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
          (this.sounding(t, wc) ||
            wc.isLoading() ||
            wc.isDevToolsOpened() ||
            this.pip.tabId === id ||
            this.fullscreenId === id ||
            isCapturing(t.capture)), // in a call: unloading it would hang up
        host,
        inActiveSpace: t.spaceId === this.activeSpaceId,
        lastShownAt: t.lastShownAt,
        // WhatsApp, Slack, mail: once it has notified or shown an unread count, it stays to tell of new ones
        messenger: (t.notes?.size ?? 0) > 0 || t.attention.count > 0 || t.attention.seenCount > 0
      })
    }
    return facts
  }

  /** Unload tabs the memory saver says are done with. `force` takes every tab that is safe to take. */
  sweepMemory(force = false): number {
    if (this.win.isDestroyed()) return 0
    const facts = this.memoryFacts()
    const ids = pickUnloads(facts, this.memoryPolicy(), Date.now(), force)
    for (const id of ids) this.unload(id)
    if (ids.length > 0) this.refresh()
    if (!force) this.rest(facts.filter((f) => !ids.includes(f.id)))
    return ids.length
  }

  /** Whether a site may send notifications (set by main/index.ts from the permission answers). */
  notifies: (url: string) => boolean = () => false

  /**
   * Hidden tabs that stay loaded give back what they can, and stop running once they have been out of sight a while
   * (see pickRests). Nothing is reloaded: shown again, a page is exactly as it was, at once.
   */
  private rest(facts: TabFacts[]): void {
    const restFacts: RestFacts[] = []
    for (const f of facts) {
      const t = this.tabs.get(f.id)
      const wc = t && liveContents(t)
      if (!t || !wc || t.unloaded) continue
      restFacts.push({
        ...f,
        rest: t.rest,
        pid: wc.getOSProcessId(),
        notifies: this.notifies(wc.getURL())
      })
    }
    const { purge, freeze } = pickRests(restFacts, this.memoryPolicy(), Date.now())
    const send = (t: Tab, method: string, params: object): void => {
      const wc = liveContents(t)
      if (wc?.debugger.isAttached())
        void wc.debugger.sendCommand(method, params).catch(() => undefined)
    }
    for (const id of purge) {
      const t = this.tabs.get(id)!
      t.rest = 'purged'
      send(t, 'Memory.simulatePressureNotification', { level: 'moderate' }) // keeps decoded images: less to redo on return
    }
    for (const id of freeze) {
      const t = this.tabs.get(id)!
      t.rest = 'frozen'
      send(t, 'Page.setWebLifecycleState', { state: 'frozen' })
    }
  }

  /** Throw a tab's page away, keeping its title, icon, snapshot and address so it comes back when shown. */
  private unload(id: number): void {
    const tab = this.tabs.get(id)
    const wc = tab && liveContents(tab)
    if (!tab || !wc || tab.unloaded) return
    const url = wc.getURL()
    if (!/^(https?|file):/i.test(url)) return
    tab.pending = { url, title: wc.getTitle(), history: historyOf(wc) }
    tab.firstUrl = url
    tab.awaiting = false
    if (tab.thumbTimer) clearTimeout(tab.thumbTimer)
    tab.thumbTimer = null
    this.destroyView(tab)
    tab.view = this.inertView()
    tab.unloaded = true
    tab.darkened = false
  }

  /**
   * Open the same page again in a new tab beside this one, of the same kind (a private tab gives a private one).
   * `spaceId` (a paste): the copy is made in that space, not shown, and left for the caller to place.
   */
  duplicate(id: number, spaceId?: number): number | null {
    const t = this.tabs.get(id)
    const wc = t && liveContents(t)
    if (!t || !wc) return null
    const url = t.failed ? t.failed.url : wc.getURL() || t.pending?.url || t.firstUrl
    if (spaceId !== undefined) {
      if (!this.deps.spaces.get(spaceId)) return null
      return this.create(url, false, spaceId, undefined, t.private, t.tor)
    }
    const copy = this.create(url, true, t.spaceId, undefined, t.private, t.tor)
    this.moveTab(copy, this.own().indexOf(id) + 1)
    return copy
  }

  /** Feedback by email: the email app, or a Gmail page in a tab when there is no email app. */
  sendFeedback(): void {
    this.openMailto(feedbackMailto())
  }

  /**
   * A mailto: link: to the email app, or, if a web mail service is chosen in Settings (or the system has no email app
   * to give it to), to that service's compose page in a tab.
   */
  private openMailto(link: string): void {
    const handler = this.deps.settings.get().mailHandler
    const web = (h: 'gmail' | 'outlook' | 'yahoo'): void => {
      const url = mailtoWebUrl(link, h)
      if (url) this.create(url)
    }
    if (handler !== 'system') return web(handler)
    shell.openExternal(link).catch(() => web('gmail'))
  }

  /** What a tab's hover card shows. The process list is read here, once, when a card opens. */
  cardInfo(id: number): TabCardInfo | null {
    const t = this.tabs.get(id)
    const wc = t && liveContents(t)
    if (!t || !wc) return null
    const url = t.failed ? t.failed.url : wc.getURL() || t.pending?.url || t.firstUrl
    let memoryMb: number | null = null
    let shared = false
    if (!t.unloaded) {
      const pid = wc.getOSProcessId()
      const metric = app.getAppMetrics().find((m) => m.pid === pid)
      if (metric) {
        // tabs of one site can share a renderer: each is shown its share of it
        let sharing = 0
        for (const other of this.tabs.values()) {
          const ow = !other.unloaded && liveContents(other)
          if (ow && ow.getOSProcessId() === pid) sharing++
        }
        shared = sharing > 1
        const kb = metric.memory.privateBytes ?? metric.memory.workingSetSize
        memoryMb = Math.round(kb / 1024 / Math.max(1, sharing))
      }
    }
    return {
      title: wc.getTitle() || t.pending?.title || '',
      host: /^(https?|file|panes):/i.test(url) ? displayHost(url) : '',
      memoryMb,
      shared,
      unloaded: t.unloaded,
      audible: this.sounding(t, wc),
      muted: wc.audioMuted,
      private: t.private,
      tor: t.tor
    }
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

  /** Push the tabs' state to the window again (something it shows changed without a tab event). */
  refresh(): void {
    if (this.win.isDestroyed()) return
    this.pruneGroups()
    const visible = this.onScreenIds()
    const now = Date.now()
    // coming back after a while out of sight: painted out of sight first (lastShownAt is still when it left)
    for (const id of visible) {
      const t = this.tabs.get(id)
      if (
        t &&
        !this.shownBefore.has(id) &&
        (t.rest !== 'awake' || now - t.lastShownAt >= WARM_AFTER_MS)
      )
        void this.warm(id)
    }
    // A tab is "recently shown" while on screen and from the moment it leaves it, so idle time starts then.
    for (const id of new Set([...visible, ...this.shownBefore])) {
      const t = this.tabs.get(id)
      if (t) t.lastShownAt = now
      // Just left the screen: from now on its notifications are what the person would miss.
      if (t && !visible.includes(id)) this.hookNotifications(t)
      // and a sharp picture of it as it was, which stands in for it, full size, when it comes back (see warm)
      if (
        t &&
        !visible.includes(id) &&
        !this.canvasMode &&
        !t.unloaded &&
        (!t.thumbSharp || t.dirty)
      )
        void this.snapshot(id, true, true)
    }
    this.shownBefore = new Set(visible)
    for (const id of visible) {
      const t = this.tabs.get(id)
      if (t?.rest === 'frozen') this.thaw(t) // Chromium wakes it as it is shown; this says so to the page too
      if (t) t.rest = 'awake'
      if (t) t.usedAt = now
      if (t) this.ensureLoaded(id, t)
      if (t && this.looking(id)) t.attention = noteSeen(t.attention)
    }
    this.applyVisibility()
    this.persistSession()
    this.pushSoon()
  }

  /**
   * Send the tabs' state to the window: at most once a frame. A page loading fires a burst of events (start, navigate,
   * title, favicon, stop) and a busy app retitles itself often; each push rebuilds every tab's state and re-renders the
   * whole interface, so a burst becomes one push. An event after a quiet spell still goes out at once.
   */
  private pushSoon(): void {
    if (this.pushTimer) return
    const wait = Math.max(0, this.pushedAt + PUSH_EVERY_MS - Date.now())
    this.pushTimer = wait > 0 ? setTimeout(this.pushNow, wait) : setImmediate(this.pushNow)
  }

  /** Send any state still waiting now, so what follows reaches the window after it (a new tab's id, say). */
  flushState(): void {
    if (this.pushTimer) this.pushNow()
  }

  private readonly pushNow = (): void => {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer as NodeJS.Timeout)
      clearImmediate(this.pushTimer as NodeJS.Immediate)
      this.pushTimer = null
    }
    if (this.win.isDestroyed()) return
    this.pushedAt = Date.now()
    const state = this.state()
    this.win.webContents.send('tabs:state', state)
    this.taskbar.update(windowAttention(state.spaceAttention))
    this.onRefresh?.()
    this.deps.spaces.setThemeOverride(
      this.activeKind() !== 'normal' || this.activeIsWelcome() ? 'dark' : null
    )
  }

  /** Print... from a menu or the command bar: the same dialog as Ctrl+P. */
  printPage(): void {
    this.onPrint?.(false)
  }

  /** Open the chat panel, with `text` (a selection) in its box when given. */
  askAi(text: string | null): void {
    if (!this.win.isDestroyed()) this.win.webContents.focus()
    this.send('ui:ask-ai', text)
  }

  private command(cmd: UiCommand): void {
    // The page view holds the keyboard when the shortcut is pressed; the find box can only take typing once the
    // window's own page does.
    if (cmd === 'find' && !this.win.isDestroyed()) this.win.webContents.focus()
    // the canvas preview has its own address and find box: these keys are its, not the board's or the top bar's
    if (this.canvasMode && this.previewOpen && (cmd === 'find' || cmd === 'focus-address')) {
      if (!this.win.isDestroyed()) this.win.webContents.focus()
      return this.send('canvas:preview-key', cmd === 'find' ? 'find' : 'address')
    }
    this.send('ui:command', cmd)
  }

  private send(channel: string, ...args: unknown[]): void {
    this.flushState() // what is sent may name a tab the window must already know
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, ...args)
  }
}
