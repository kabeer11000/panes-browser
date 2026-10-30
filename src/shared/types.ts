import type { LocalSuggestion } from './search'
import type { UpdateState } from './update'
import type { Edge, LayoutNode } from './layout'
import type { PerformanceMode, RunningMode } from './performance'
import type { PermDecision, PermKind, PermSetting, SiteGrant } from './permissions'
import type { TabKind } from './tabkind'
import type { CaptureKind, CaptureState } from './capture'
import type { SpaceAttention, TabAttention } from './attention'
import type { TabDump } from './dumps'
import type { TorState, TorStatus } from './tor'
import type { YouTubeCodec, YouTubeQuality } from './youtube'
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
  /** A private tab that goes out through Tor. */
  tor: boolean
  /** Kept at the start of the list, small, and out of the way of accidental closing. */
  pinned: boolean
  /** What the page is capturing right now: camera, microphone, screen. */
  capture: CaptureState
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
  /** New messages or a call waiting for the person (cleared once they look at the tab). */
  attention: TabAttention
  bookmarked: boolean
  canGoBack: boolean
  canGoForward: boolean
}

/** Interface settings a space can override; anything unset falls back to the global setting. */
export interface SpaceUi {
  uiScale?: number
  pageZoom?: number
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
  /** Sound in every space, not just this one: a space with a tab playing (or muted) shows it. */
  spaceAudio: Record<number, { playing: boolean; muted: boolean }>
  /** What is waiting in every space (only spaces with something): unread, unseen, a call and the tab it is in. */
  spaceAttention: Record<number, SpaceAttention>
  /** Tor, for Tor tabs that wait on it and for the chip that says how it is doing. */
  tor: { state: TorState; progress: number; message: string; tabs: number }
  /** Something that just happened, said for a few seconds (a saved session). `id` tells one saying from the next. */
  notice: { id: number; text: string } | null
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
  /** Tile several tabs side by side (the tabs picked with Shift or Ctrl). */
  splitMany(ids: number[]): void
  unsplit(keepId?: number): void
  toggleSplit(): void
  /** Drop a tab on an edge (or the centre) of the pane showing targetId. */
  dropTab(id: number, targetId: number, edge: Edge | 'center'): void
  closePane(id: number): void
  /** Native right-click menus; their choices come back as state changes (and rename requests). */
  tabMenu(id: number, picked?: number[]): void
  /** The pointer rests on a tab (with where it is) or has left it (null): show or hide its card. */
  tabHover(id: number | null, anchor?: TabHoverAnchor): void
  /** Open the email app with a message to the developer. */
  sendFeedback(): void
  /** Take the downloads bin off the window (the pane view is open over its edge), or let it back. */
  hideDock(hide: boolean): void
  /** Open or close the site panel under the address bar's site button. */
  toggleSitePanel(anchor: Rect): void
  addToGroup(id: number, groupId: number): void
  siteInfo(): Promise<SiteInfo | null>
  siteUpdate(patch: SitePatch): Promise<SiteInfo | null>
  groupMenu(id: number): void
  /** Mute what is playing in a space, or (when nothing is) unmute what was muted. */
  muteSpace(id: number): void
  newPrivateTab(): void
  /** Start Tor again (it dropped, or could not connect). */
  torReconnect(): void
  newTorTab(): void
  /** The browser menu (pages, sessions, settings) at a point, for when there is no sidebar to hold those buttons. */
  appMenu(x: number, y: number): void
  updateGroup(id: number, patch: Partial<Pick<TabGroup, 'name' | 'color' | 'collapsed'>>): void
  onRenameGroup(cb: (id: number) => void): () => void
  /** End what a tab is capturing (camera, microphone or screen). */
  stopCapture(id: number, kinds: CaptureKind[]): void
  toggleMute(id: number): void
  /** Keep this photo on the new tab page (null goes back to the daily one). */
  setNewTabPhoto(id: number | null): void
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
  /** `groupId`: the group the tab ends up in (null for none); left out, it is worked out from its neighbours. */
  moveTab(id: number, index: number, groupId?: number | null): void
  /** Move several picked tabs together to the drop slot. */
  moveTabs(ids: number[], index: number, groupId?: number | null): void
  /** Hide the native page view (so renderer overlays can show); snapshots the active tab first. */
  setOverlay(open: boolean, snapshot?: boolean, sharp?: boolean): Promise<void>
  /** Shift the page views right by x and down by y pixels, keeping their size (the hover sidebar or top bar sliding out). */
  setSlide(x: number, y: number): void
  minimizeWindow(): void
  toggleMaximizeWindow(): void
  closeWindow(): void
  getSettings(): Promise<Settings>
  onSettings(cb: (settings: Settings) => void): () => void
  openInternal(
    page: 'history' | 'bookmarks' | 'downloads' | 'passwords' | 'settings' | 'privacy' | 'software'
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

/** A page to open from a list: its address, and the title and icon its tab shows until it is visited. */
export interface OpenItem {
  url: string
  title: string
  favicon: string | null
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
  /** Reach Tor through Snowflake bridges (for networks that block Tor). */
  torSnowflake: boolean
  /** Sites whose tabs are always muted, subdomains included. */
  mutedSites: string[]
  /** Page zoom per site (host name to Chromium zoom level; 0 is 100%). */
  siteZoom: Record<string, number>
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
  /** How large pages start out, as a zoom level (0 is 100%). A site's own zoom wins. */
  pageZoom: number
  /** Show the full address, or just the site name, when the bar is not being edited. */
  urlDisplay: 'full' | 'host'
  /** How much a page's stored picture is softened while it stands in for the live page (an overlay is open). */
  frozenBlur: 'off' | 'slight' | 'strong'
  /** A daily landscape photo behind the new tab page (fetched from picsum.photos; never in private or Tor tabs). */
  newTabPhoto: boolean
  /** The photo kept on the new tab page (an id from shared/photos); null follows the daily one. */
  newTabPhotoId: number | null
  /** The new tab photo as a two-tone dither in the space's colours (off: the photo as it is). */
  newTabDither: boolean
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
  /** Pane view (Ctrl and scroll): the tabs fill the page area, or a small strip down the right edge beside the page. */
  paneView: 'full' | 'side'
  /** Letting go of Ctrl in the pane view: open the tab it is on (as Alt+Tab does), or leave the view open. */
  paneViewRelease: 'select' | 'stay'
  /** What opens mailto: links (and the feedback message): the system's email app, or a web mail service. */
  mailHandler: 'system' | 'gmail' | 'outlook' | 'yahoo'
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
  /** YouTube: hide Shorts shelves, the Shorts menu entry and Shorts in results. */
  youtubeHideShorts: boolean
  /** YouTube: hide the cards and end screen laid over a video. */
  youtubeHideEndCards: boolean
  youtubeHideComments: boolean
  /** YouTube: the speed each video starts at (1 leaves it to YouTube). */
  youtubeSpeed: number
  /** YouTube: the quality each video starts at, or the best below it (`auto` leaves it to YouTube). */
  youtubeQuality: YouTubeQuality
  /** YouTube: video formats to avoid, to save CPU and battery (`auto` avoids none). */
  youtubeCodec: YouTubeCodec
  /** YouTube: open videos in theater mode. */
  youtubeTheater: boolean
  /** YouTube: leave its "autoplay the next video" switch alone (false turns it off). */
  youtubeAutoplay: boolean
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

/** The certificate a site last presented over HTTPS, as Chromium checked it. */
export interface SiteCert {
  subject: string
  issuer: string
  /** ms since epoch */
  validFrom: number
  validTo: number
  /** Chromium accepted it; false when the page was let through despite an error. */
  ok: boolean
}

/** One kind of access in the site settings: its setting, and how the page on screen stands with it. */
export interface SitePerm {
  kind: PermKind
  setting: PermSetting
  /** "Allow this time": when it lapses (ms since epoch), else null. */
  until: number | null
  /** What the page on screen was told when it last asked, or null if it has not asked since it loaded. */
  asked: 'granted' | 'refused' | null
}

/** What the site settings panel shows for the page you are on. */
export interface SiteInfo {
  key: string
  origin: string
  /** host[:port], as the panel names the site */
  host: string
  title: string
  favicon: string | null
  loading: boolean
  secure: boolean
  /** The certificate behind `secure`, when one has been seen this run. */
  cert: SiteCert | null
  /** A private or Tor tab: its answers and data last only until Panes closes. */
  tabKind: TabKind
  /** Cookies this site has set that the browser would send it. */
  cookies: number
  spaceName: string
  /** `global` is the main ad blocker switch; `off` is this site's exception. */
  adblock: { global: boolean; off: boolean; cosmetic: boolean; blocked: number }
  /** This site's boost in the current space, or null for none. */
  boost: SiteTheme | null
  keepLoaded: boolean
  /** The site's page zoom as a Chromium level: 0 is 100%, each step is one 1.2 times. */
  zoom: number
  /** Where its space starts pages out, a level: what the reset button returns to. */
  defaultZoom: number
  /** The site is muted wherever it is open. */
  muted: boolean
  /** Every kind, in PERM_KINDS order. */
  perms: SitePerm[]
  /** Kinds whose current setting the page will only see once it reloads. */
  reload: PermKind[]
  /** What the page is capturing right now. */
  capture: CaptureState
  /** The space's own colour, for the panel to wear. */
  theme: { color: string; tint: number }
}

/** One change from the panel; main validates every field. */
export interface SitePatch {
  adblockOff?: boolean
  /** Forget the site's cookies and stored data. */
  clearData?: boolean
  /** Reload the page, so it sees settings it could not be told about. */
  reload?: boolean
  /** Whether the blocker may hide elements on the page (requests stay blocked either way). */
  adblockCosmetic?: boolean
  boost?: SiteTheme | null
  /** Hide one more element (its selector), or bring one back. */
  zapAdd?: string
  zapRemove?: string
  keepLoaded?: boolean
  muted?: boolean
  zoom?: number
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
  /** A small picture of the file (a thumbnail of an image, else its icon) as a data URL, once it has finished. */
  preview?: string
}

/** A download that has just begun, and where on the window the pointer was, for the flight to the downloads bin. */
export interface DownloadStart {
  download: DownloadInfo
  at: { x: number; y: number } | null
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
  /** Open the email app with a message to the developer. */
  sendFeedback(): Promise<void>
  historyList(query: string, limit: number, offset: number): Promise<HistoryEntry[]>
  historyRemove(id: number): Promise<void>
  historyRemoveMany(ids: number[]): Promise<void>
  /** Open pages in new tabs (web addresses only, at most BULK_OPEN_MAX): the first shown, the rest waiting. Resolves with how many opened. */
  openMany(items: OpenItem[]): Promise<number>
  bookmarksList(): Promise<Bookmark[]>
  bookmarkRemove(id: number): Promise<void>
  /** Saved sessions: sets of tabs to open again or send on. */
  /** Open the system's touchpad settings, where a gesture can be set to send a shortcut. */
  openTouchpadSettings(): Promise<void>
  torStatus(): Promise<TorStatus>
  /** Download if needed and start Tor; resolves when it is usable or has failed (see the status). */
  torStart(snowflake: boolean): Promise<void>
  torStop(): Promise<void>
  /** A private tab through Tor, once Tor is ready. */
  torNewTab(): Promise<void>
  privateNewTab(): Promise<void>
  dumpsList(): Promise<TabDump[]>
  /** Save this space's open tabs; `close` also closes them. Null when there was nothing to save. */
  dumpSave(close: boolean): Promise<TabDump | null>
  dumpOpen(id: number): Promise<void>
  dumpRename(id: number, name: string): Promise<void>
  dumpRemove(id: number): Promise<void>
  downloadsList(): Promise<DownloadInfo[]>
  downloadAction(id: number, action: DownloadAction): Promise<void>
  /** Pictures of finished downloads (data URLs), for the ones that have one yet; the rest are made in the background. */
  downloadPreviews(ids: number[]): Promise<Record<number, string>>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  permissionsList(): Promise<SiteGrant[]>
  /** A decision for one site and kind, or null to ask again. */
  permissionSet(origin: string, kind: PermKind, decision: PermDecision | null): Promise<void>
  permissionRemove(origin: string, kind: PermKind): Promise<void>
  permissionsReset(): Promise<void>
  /** Saved decisions changed (here, in the site panel, or from a prompt): read them again. */
  onPermissionsChanged(cb: () => void): () => void
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

/** Where the hovered tab is in the window, and which side of it the card goes. */
export interface TabHoverAnchor extends Rect {
  side: 'below' | 'right'
}

/** What the hover card says about a tab. */
export interface TabCardInfo {
  title: string
  host: string
  /** Memory the tab's page process uses, or null when it cannot be read. */
  memoryMb: number | null
  /** Other tabs live in the same process, so the number is this tab's share of it. */
  shared: boolean
  unloaded: boolean
  audible: boolean
  muted: boolean
  private: boolean
  tor: boolean
}

/** How much of the downloads bin is showing: a sliver at the window's edge, or the bin out. */
export type DockMode = 'peek' | 'out'

/** What the fan view (a window-sized transparent view, shown only for a fan or a flight) tells the bin. */
export interface DockOverlayState {
  /** The fan is open. */
  open: boolean
  /** The fan is open or a file is on its way to the bin: the bin stays out and the fan view covers the window. */
  active: boolean
}

/**
 * What the downloads bin can do. Two transparent views above the page share it: the bin (a small view at the window's
 * bottom-right corner, only ever moved, never resized) and the fan (window-sized, shown only while it is needed).
 */
export interface DockApi {
  downloads(): Promise<DownloadInfo[]>
  onDownloads(cb: (list: DownloadInfo[]) => void): () => void
  onStart(cb: (start: DownloadStart) => void): () => void
  /** The pointer is resting in the corner (told by the main process, which can see it over the page). */
  onCorner(cb: (here: boolean) => void): () => void
  act(id: number, action: DownloadAction): void
  /** Open the downloads page. */
  openDownloads(): void
  /** Bin: say how much of it should show. */
  setMode(mode: DockMode): void
  /** Bin: it was clicked, so the fan opens or closes. */
  toggle(): void
  /** Bin: told what the fan is doing. */
  onOverlay(cb: (state: DockOverlayState) => void): () => void
  /** Bin: a file has landed in it. */
  onLanded(cb: () => void): () => void
  /** Fan: told the bin was clicked. */
  onToggle(cb: () => void): () => void
  /** Fan: say what it is doing, so the view is shown while it is needed. */
  report(state: DockOverlayState): void
  /** Fan: a file has landed in the bin. */
  landed(): void
  /** The bin is told to sink below the window's edge (before it goes), to wait there unseen, or to rise from it. */
  onSlide(cb: (kind: 'sink' | 'tuck' | 'rise') => void): () => void
}

/** What the tab hover card (a transparent view above the page) can do. */
export interface TabCardApi {
  state(): Promise<TabCardInfo | null>
  onState(cb: (info: TabCardInfo | null) => void): () => void
  /** Content height, so the main process can size the view to fit the card. */
  resize(height: number): void
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
  /** Data URL of a small preview; empty when the system gave none (a minimised window). */
  thumb: string
  /** The window's application icon, shown when there is no preview. */
  icon: string
}

/** What the permission card shows: a site asking for something, or a site asking to share the screen. */
export interface PermissionPromptState {
  /** Which question this is, so an answer can never land on another that took its place. */
  id: number
  origin: string
  /** Asked in a private or Tor tab: the answer is forgotten when Panes closes. */
  temporary?: boolean
  kinds: PermKind[]
  /** Present for screen sharing: what the page may capture, picked from a list instead of allowed or blocked. */
  sources?: ScreenSource[]
  /** The picker is open and the system has not listed what can be shared yet. */
  loading?: boolean
  /** The page asked for the system's sound as well (only whole screens can give it). */
  audio?: boolean
  /** The system itself is keeping apps from this device: the card says so and points to the switch. */
  blocked?: 'camera' | 'microphone'
}

export type PermissionAnswer =
  | { action: 'allow' | 'once' | 'block' | 'cancel' | 'openSettings' }
  | { action: 'share'; sourceId: string; audio: boolean }

/** What the permission card (a transparent view above the page) can do. */
export interface PermissionApi {
  state(): Promise<PermissionPromptState | null>
  onState(cb: (state: PermissionPromptState | null) => void): () => void
  resize(height: number): void
  answer(id: number, answer: PermissionAnswer): void
}

/** What the site panel (a transparent view above the page) can do. */
export interface SitePanelApi {
  info(): Promise<SiteInfo | null>
  update(patch: SitePatch): Promise<SiteInfo | null>
  close(): void
  /** Let the user choose an element on the page to hide. */
  pick(): void
  /** The panel was opened (or a pick finished): start from its first screen. */
  onShow(cb: () => void): () => void
  /** The panel has been closed: throw the card away, so the next opening starts fresh. */
  onHide(cb: () => void): () => void
  /** Fresh state while the panel is open: the tab navigated or loaded, a setting changed elsewhere. */
  onInfo(cb: (info: SiteInfo | null) => void): () => void
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
