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

export interface TabsState {
  tabs: TabInfo[]
  activeId: number | null
  /** Tiled group of tabs shown together, if any. */
  layout: LayoutNode | null
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
  setRatios(path: number[], ratios: number[]): void
  /** Move a tab to an insertion index (counted with the tab still in the list). */
  moveTab(id: number, index: number): void
  /** Hide the native page view (so renderer overlays can show); snapshots the active tab first. */
  setOverlay(open: boolean): Promise<void>
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
}
