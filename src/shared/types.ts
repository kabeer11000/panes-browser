import type { LocalSuggestion } from './search'
import type { UpdateState } from './update'
import type { Edge, LayoutNode } from './layout'
import type { PerformanceMode, RunningMode } from './performance'
import type { PermDecision, PermKind, SiteGrant } from './permissions'
import type { TabDump } from './dumps'
import type { TabGroup } from './tabgroups'
import type { SpaceIcon } from './spaceicons'

export type SpaceMode = 'system' | 'dark' | 'light'

export interface TabInfo {
  id: number
  url: string
  title: string
  favicon: string | null
  loading: boolean
  /** Opened as a private tab: no history, no saved session, its own in-memory cookies. */
  private: boolean
  /** The sidebar group this tab belongs to, if any. */
  groupId: number | null
  /** This tab's page is out in a floating picture-in-picture window. */
  pip: boolean
  /** The page has been unloaded to save memory (or not loaded yet) and loads when shown. */
  unloaded: boolean
  /** The page is currently making sound. */
  audible: boolean
  /** The tab's audio is muted by the user. */
  muted: boolean
  bookmarked: boolean
  canGoBack: boolean
  canGoForward: boolean
}

/** Interface settings a space can override; anything unset falls back to the global setting. */
export interface SpaceUi {
  uiScale?: number
  density?: number
  sidebarWidth?: number
  pageMargin?: number
  addressSize?: number
  urlDisplay?: 'full' | 'host'
}

/** A named, themed set of tabs with its own sidebar and address bar configuration. */
export interface Space {
  id: number
  name: string
  /** Primary theme colour; also the colour of the space's chip. */
  color: string
  /** Optional second colour; with one set the window background is a gradient between the two. */
  color2: string | null
  /** How strongly the theme tints the window, 0 to 1. */
  tint: number
  /** Film grain over the tinted background, 0 to 1. */
  grain: number
  /** Glyph on the space's avatar. */
  icon: SpaceIcon
  /** Light or dark interface while in this space; 'system' follows the operating system. */
  mode: SpaceMode
  ui: SpaceUi
  /** Page recolouring for individual sites, only while browsing in this space. Keyed by siteKey(). */
  sites: Record<string, SiteTheme>
}

/** A boost: how one site's pages are restyled in one space. Colour, type, hidden parts and your own CSS. */
export interface SiteTheme {
  /** Invert the page into a dark version (pictures stay as they are). */
  dark: boolean
  /** The theme colour: pages are mapped from near-black to near-white along a gradient built from it. */
  tint: string | null
  /** How far the page moves toward the theme, 0 to 1. */
  strength: number
  /** 0.6 to 1.4; 1 leaves it alone. */
  brightness: number
  contrast: number
  /** 0 to 2; 1 leaves it alone. */
  saturation: number
  /** A key of BOOST_FONTS, or null for the site's own typeface. */
  font: string | null
  /** Selectors of elements to hide (zapped). */
  zap: string[]
  /** Your own CSS, applied last. */
  css: string
}

/** Fields of a space that can be edited; main validates every one. */
export interface SpacePatch {
  name?: string
  color?: string
  color2?: string | null
  tint?: number
  grain?: number
  icon?: SpaceIcon
  mode?: SpaceMode
  ui?: SpaceUi
}

export interface TabsState {
  tabs: TabInfo[]
  activeId: number | null
  /** Tiled group of tabs shown together, if any. */
  layout: LayoutNode | null
  spaces: Space[]
  activeSpaceId: number
  /** Groups in the active space, in no particular order (tab order says where each one sits). */
  tabGroups: TabGroup[]
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Commands main sends to the renderer UI (usually from keyboard shortcuts). */
export type UiCommand =
  'focus-address' | 'toggle-taskview' | 'toggle-sidebar' | 'find' | 'open-stack'

export interface PanesApi {
  getState(): Promise<InitialData>
  onState(cb: (state: TabsState) => void): () => void
  onThumb(cb: (id: number, dataUrl: string) => void): () => void
  onCommand(cb: (cmd: UiCommand) => void): () => void
  /** Ctrl+wheel over a page. dy uses DOM units: positive = scroll down (deeper into the stack). */
  onStackWheel(cb: (dy: number) => void): () => void
  /** Ctrl key released (commit point for the tab stack). */
  onStackRelease(cb: () => void): () => void
  createTab(input?: string): void
  closeTab(id: number): void
  activateTab(id: number): void
  navigate(input: string): void
  back(): void
  forward(): void
  reload(): void
  stop(): void
  /** Where each visible tab's native view goes, keyed by tab id. */
  setContentBounds(rects: Record<number, Rect>): void
  splitWith(id: number): void
  unsplit(keepId?: number): void
  toggleSplit(): void
  /** Drop a tab on an edge (or the centre) of the pane showing targetId. */
  dropTab(id: number, targetId: number, edge: Edge | 'center'): void
  closePane(id: number): void
  /** Native right-click menus; their choices come back as state changes (and rename requests). */
  tabMenu(id: number): void
  /** Open or close the site panel under the address bar's site button. */
  toggleSitePanel(anchor: Rect): void
  addToGroup(id: number, groupId: number): void
  siteInfo(): Promise<SiteInfo | null>
  siteUpdate(patch: SitePatch): Promise<SiteInfo | null>
  groupMenu(id: number): void
  /** The browser menu (pages, sessions, settings) at a point, for when there is no sidebar to hold those buttons. */
  appMenu(x: number, y: number): void
  updateGroup(id: number, patch: Partial<Pick<TabGroup, 'name' | 'color' | 'collapsed'>>): void
  onRenameGroup(cb: (id: number) => void): () => void
  toggleMute(id: number): void
  /** Float the current tab's video in a small window (or bring it back). */
  togglePip(): void
  exitPip(): void
  /** Ask main to watch the cursor and report when it touches the top edge (auto-hidden top bar). */
  watchTopBar(enabled: boolean, barPx: number): void
  /** Tell main whether the left-edge sidebar trigger is wanted and where the sidebar stands. */
  watchSidebar(enabled: boolean, open: boolean, openedByHover: boolean, widthPx: number): void
  /** Whether Panes is the default browser, for the sidebar prompt. */
  isDefaultBrowser(): Promise<boolean>
  setDefaultBrowser(): Promise<void>
  /** Stop asking about the default browser. */
  dismissDefaultBrowser(): void
  onSideHover(cb: (action: 'open' | 'close') => void): () => void
  onPeekBar(cb: (show: boolean) => void): () => void
  suggestLocal(query: string): Promise<LocalSuggestion[]>
  suggestRemote(query: string): Promise<string[]>
  openInSplit(input: string): void
  switchSpace(id: number): void
  createSpace(): void
  moveTabToSpace(tabId: number, spaceId: number): void
  updateSpace(id: number, patch: SpacePatch): void
  deleteSpace(id: number): void
  /** Take a pane out of the split and show it alone at full size. */
  popOutPane(id: number): void
  setRatios(path: number[], ratios: number[]): void
  /** Move a tab to an insertion index (counted with the tab still in the list). */
  moveTab(id: number, index: number): void
  /** Hide the native page view (so renderer overlays can show); snapshots the active tab first. */
  setOverlay(open: boolean, snapshot?: boolean): Promise<void>
  minimizeWindow(): void
  toggleMaximizeWindow(): void
  closeWindow(): void
  getSettings(): Promise<Settings>
  onSettings(cb: (settings: Settings) => void): () => void
  openInternal(
    page: 'history' | 'bookmarks' | 'downloads' | 'passwords' | 'settings' | 'software'
  ): void
  /** A login was submitted that is worth saving; null clears the prompt. */
  onPasswordPrompt(cb: (prompt: PasswordPrompt | null) => void): () => void
  answerPassword(answer: 'save' | 'never' | 'dismiss', edits?: LoginEdits): void
  /** Where the app is with updating itself; pushed as it changes. */
  onUpdateState(cb: (state: UpdateState) => void): () => void
  getUpdateState(): Promise<UpdateState>
  /** Restart into a downloaded update. */
  installUpdate(): void
  /** The password waiting in the save prompt, fetched only when the user asks to see it. */
  revealPendingPassword(): Promise<string | null>
  /** Where the save-password popover should hang, or null to hide it. Only used with the sidebar closed. */
  setPromptAnchor(anchor: PromptAnchor | null): void
  toggleBookmark(): void
  find(text: string, forward?: boolean): void
  stopFind(): void
  onFindResult(cb: (result: FindResult) => void): () => void
  platform: NodeJS.Platform
}

export interface InitialData {
  state: TabsState
  thumbs: Record<number, string>
}

export type SearchEngineId = 'duckduckgo' | 'google' | 'bing' | 'brave'

export interface Settings {
  searchEngine: SearchEngineId
  adblock: boolean
  /** Sites (host names) where the ad blocker is off even though it is on everywhere else. */
  adblockOffSites: string[]
  /** Sites where requests are still blocked but the blocker leaves the page's own elements alone. */
  adblockCosmeticOffSites: string[]
  startup: 'newtab' | 'restore'
  accent: string
  /** Scales text and icons in the sidebar and headers. */
  uiScale: number
  /** Scales heights and spacing, so lower is thinner. */
  density: number
  sidebarWidth: number
  /** Space around the page area in px. */
  pageMargin: number
  /** Scales the address bar's height and text. */
  addressSize: number
  /** Show the full address, or just the site name, when the bar is not being edited. */
  urlDisplay: 'full' | 'host'
  /** Send what you type in the command bar to your search engine to get suggestions. */
  searchSuggestions: boolean
  /** With the sidebar collapsed, hide the top bar until the pointer touches the top edge. */
  autoHideTopBar: boolean
  /** With the sidebar collapsed, open it when the pointer touches the left edge; it tucks away again when the pointer leaves. */
  sidebarHover: boolean
  /** Tabs down the side (a sidebar) or along the top. */
  tabLayout: 'vertical' | 'horizontal'
  /** With tabs along the top, the address bar spans the whole row rather than sitting in the middle of it. */
  fullWidthAddress: boolean
  /** Where the command bar appears: grown out of the address bar, or centred on the page. */
  searchStyle: 'dropdown' | 'center'
  /** In a dark space, darken pages that do not have a dark theme of their own. */
  darkenSites: boolean
  /** The welcome pages have been seen (or skipped). */
  onboarded: boolean
  /** Show the "make Panes your default browser" prompt until it is answered or dismissed. */
  askDefaultBrowser: boolean
  /** How Chromium is set up at launch: one process per tab, or tabs of a site sharing one. Applies after a restart. */
  performanceMode: PerformanceMode
  /** Unload background tabs to free memory. They reload when you open them. */
  memorySaver: boolean
  /** Minutes a background tab can sit unused before it is unloaded. */
  unloadIdleMin: number
  /** Most tabs kept loaded at once; 0 means no limit. */
  maxLoadedTabs: number
  /** Tabs in spaces you are not using unload after a couple of minutes. */
  unloadOtherSpaces: boolean
  /** Sites whose tabs are never unloaded (host names; subdomains match too). */
  neverUnloadSites: string[]
}

/** What the memory section of settings shows. */
export interface MemoryStats {
  usedMb: number
  loaded: number
  unloaded: number
  /** The mode this run actually started in (the setting may have changed since). */
  runningMode: RunningMode
  /** This computer's memory, which Auto decides by. */
  totalGb: number
}

/** What the site settings panel shows for the page you are on. */
export interface SiteInfo {
  key: string
  origin: string
  secure: boolean
  /** Cookies this site has set that the browser would send it. */
  cookies: number
  spaceName: string
  /** `global` is the main ad blocker switch; `off` is this site's exception. */
  adblock: { global: boolean; off: boolean; cosmetic: boolean; blocked: number }
  /** This site's boost in the current space, or null for none. */
  boost: SiteTheme | null
  keepLoaded: boolean
  perms: Partial<Record<PermKind, PermDecision>>
  /** The space's own colour, for the panel to wear. */
  theme: { color: string; tint: number }
}

/** One change from the panel; main validates every field. */
export interface SitePatch {
  adblockOff?: boolean
  /** Forget the site's cookies and stored data. */
  clearData?: boolean
  /** Allow camera, microphone and screen sharing together: what a call site needs. */
  allowCalls?: boolean
  /** Whether the blocker may hide elements on the page (requests stay blocked either way). */
  adblockCosmetic?: boolean
  boost?: SiteTheme | null
  /** Hide one more element (its selector), or bring one back. */
  zapAdd?: string
  zapRemove?: string
  keepLoaded?: boolean
  /** A decision for one kind of access, or null to ask again. */
  perm?: { kind: PermKind; decision: PermDecision | null }
  reset?: boolean
}

export interface FindResult {
  active: number
  matches: number
}

export interface HistoryEntry {
  id: number
  url: string
  title: string
  favicon: string | null
  time: number
}

export interface Bookmark {
  id: number
  url: string
  title: string
  favicon: string | null
  time: number
}

export type DownloadState = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'

export interface DownloadInfo {
  id: number
  filename: string
  url: string
  savePath: string
  total: number
  received: number
  state: DownloadState
  time: number
}

export type DownloadAction = 'open' | 'show' | 'cancel' | 'pause' | 'resume' | 'remove'
export type ClearKind = 'history' | 'cookies' | 'cache' | 'downloads'

/** API exposed to panes:// pages only. */
/** What the save-password bar asks the user. The password itself never leaves the main process. */
/** What the save prompt sends back besides the answer: the username and password as edited. A null password means unchanged. */
export interface LoginEdits {
  username: string
  password: string | null
}

export interface PasswordPrompt {
  origin: string
  username: string
  kind: 'save' | 'update'
}

export interface LoginSummary {
  id: number
  origin: string
  username: string
  updated: number
}

export interface LoginInput {
  origin: string
  username: string
  password: string
}

/** What the Software page shows about this build. */
export interface AboutInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
}

export interface InternalApi {
  updateState(): Promise<UpdateState>
  updateCheck(): Promise<void>
  updateInstall(): Promise<void>
  about(): Promise<AboutInfo>
  historyList(query: string, limit: number, offset: number): Promise<HistoryEntry[]>
  historyRemove(id: number): Promise<void>
  historyRemoveMany(ids: number[]): Promise<void>
  bookmarksList(): Promise<Bookmark[]>
  bookmarkRemove(id: number): Promise<void>
  /** Saved sessions: sets of tabs to open again or send on. */
  /** Open the system's touchpad settings, where a gesture can be set to send a shortcut. */
  openTouchpadSettings(): Promise<void>
  dumpsList(): Promise<TabDump[]>
  /** Save this space's open tabs; `close` also closes them. Null when there was nothing to save. */
  dumpSave(close: boolean): Promise<TabDump | null>
  dumpOpen(id: number): Promise<void>
  dumpRename(id: number, name: string): Promise<void>
  dumpRemove(id: number): Promise<void>
  downloadsList(): Promise<DownloadInfo[]>
  downloadAction(id: number, action: DownloadAction): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  permissionsList(): Promise<SiteGrant[]>
  permissionRemove(origin: string, kind: PermKind): Promise<void>
  permissionsReset(): Promise<void>
  memoryStats(): Promise<MemoryStats>
  memoryFree(): Promise<number>
  restart(): Promise<void>
  /** The welcome page is finished: remember that, and close it. */
  onboardingDone(): Promise<void>
  /** Whether Panes is what the system opens web links with. */
  defaultBrowserStatus(): Promise<boolean>
  /** Ask the system to make it so (it may open the system's default apps page). */
  defaultBrowserRequest(): Promise<void>
  clearData(kinds: ClearKind[], sinceMs: number | null): Promise<void>
  spacesList(): Promise<Space[]>
  spaceCreate(): Promise<Space>
  spaceUpdate(id: number, patch: SpacePatch): Promise<void>
  spaceDelete(id: number): Promise<void>
  passwordsList(): Promise<LoginSummary[]>
  passwordReveal(id: number): Promise<string | null>
  /** Adds a login, or changes the password of the one with the same site and username. */
  passwordSave(login: LoginInput): Promise<boolean>
  passwordEdit(id: number, username: string, password: string): Promise<boolean>
  passwordRemove(id: number): Promise<void>
  passwordsImport(csv: string): Promise<{ added: number; skipped: number }>
  passwordsExport(): Promise<string>
  passwordGenerate(): Promise<string>
}

export interface PipState {
  playing: boolean
  current: number
  duration: number
  muted: boolean
  w: number
  h: number
}

/** The address bar's rectangle in window coordinates, plus the colours the popover should wear. */
export interface PromptAnchor {
  x: number
  y: number
  width: number
  height: number
  theme: { scheme: 'dark' | 'light'; color: string; color2: string }
}

/** What the save-password popover shows; null prompt means nothing to show. */
export interface PopoverState {
  prompt: PasswordPrompt | null
  theme: PromptAnchor['theme']
}

/** What the save-password popover (a transparent view above the page) can do. */
export interface PopoverApi {
  state(): Promise<PopoverState>
  onState(cb: (state: PopoverState) => void): () => void
  /** Content height, so the main process can size the view to fit the card. */
  resize(height: number): void
  answer(answer: 'save' | 'never' | 'dismiss', edits?: LoginEdits): void
  reveal(): Promise<string | null>
}

/** A screen or window a page may capture, as offered in the screen-sharing picker. */
export interface ScreenSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** Data URL of a small preview. */
  thumb: string
}

/** What the permission card shows: a site asking for something, or a site asking to share the screen. */
export interface PermissionPromptState {
  origin: string
  kinds: PermKind[]
  /** Present for screen sharing: what the page may capture, picked from a list instead of allowed or blocked. */
  sources?: ScreenSource[]
}

export type PermissionAnswer =
  { action: 'allow' | 'once' | 'block' | 'cancel' } | { action: 'share'; sourceId: string }

/** What the permission card (a transparent view above the page) can do. */
export interface PermissionApi {
  state(): Promise<PermissionPromptState | null>
  onState(cb: (state: PermissionPromptState | null) => void): () => void
  resize(height: number): void
  answer(answer: PermissionAnswer): void
}

/** What the site panel (a transparent view above the page) can do. */
export interface SitePanelApi {
  info(): Promise<SiteInfo | null>
  update(patch: SitePatch): Promise<SiteInfo | null>
  /** Content height, so the main process can size the view to fit the card. */
  resize(height: number): void
  close(): void
  /** Let the user choose an element on the page to hide. */
  pick(): void
  /** The panel was opened (or a pick finished): read it again. */
  onShow(cb: () => void): () => void
}

/** What the picture-in-picture controls overlay can do. */
export interface PipApi {
  onState(cb: (state: PipState) => void): () => void
  playPause(): void
  seek(to: number): void
  skip(delta: number): void
  toggleMute(): void
  close(): void
  back(): void
  drag(phase: 'start' | 'move' | 'end'): void
}
