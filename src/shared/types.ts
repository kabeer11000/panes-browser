import type { LocalSuggestion } from './search'
import type { Edge, LayoutNode } from './layout'

export interface TabInfo {
  id: number
  url: string
  title: string
  favicon: string | null
  loading: boolean
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
  /** Light or dark interface while in this space. */
  mode: 'dark' | 'light'
  ui: SpaceUi
}

/** Fields of a space that can be edited; main validates every one. */
export interface SpacePatch {
  name?: string
  color?: string
  color2?: string | null
  tint?: number
  grain?: number
  mode?: 'dark' | 'light'
  ui?: SpaceUi
}

export interface TabsState {
  tabs: TabInfo[]
  activeId: number | null
  /** Tiled group of tabs shown together, if any. */
  layout: LayoutNode | null
  spaces: Space[]
  activeSpaceId: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Commands main sends to the renderer UI (usually from keyboard shortcuts). */
export type UiCommand = 'focus-address' | 'toggle-taskview' | 'toggle-sidebar' | 'find'

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
  /** Ask main to watch the cursor and report when it touches the top edge (auto-hidden top bar). */
  watchTopBar(enabled: boolean, barPx: number): void
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
  openInternal(page: 'history' | 'bookmarks' | 'downloads' | 'settings'): void
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
  /** Where the command bar appears: grown out of the address bar, or centred on the page. */
  searchStyle: 'dropdown' | 'center'
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
export interface InternalApi {
  historyList(query: string, limit: number, offset: number): Promise<HistoryEntry[]>
  historyRemove(id: number): Promise<void>
  bookmarksList(): Promise<Bookmark[]>
  bookmarkRemove(id: number): Promise<void>
  downloadsList(): Promise<DownloadInfo[]>
  downloadAction(id: number, action: DownloadAction): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  clearData(kinds: ClearKind[], sinceMs: number | null): Promise<void>
  spacesList(): Promise<Space[]>
  spaceCreate(): Promise<Space>
  spaceUpdate(id: number, patch: SpacePatch): Promise<void>
  spaceDelete(id: number): Promise<void>
}
