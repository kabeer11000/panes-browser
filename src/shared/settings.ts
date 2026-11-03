import type { SearchEngineId, Settings } from './types'
import { YOUTUBE_DEFAULTS } from './youtube'

export const SEARCH_ENGINES: Record<SearchEngineId, { name: string; url: string }> = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' }
}

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'duckduckgo',
  adblock: true,
  askDefaultBrowser: true,
  onboarded: false,
  performanceMode: 'auto',
  adblockOffSites: [],
  adblockCosmeticOffSites: [],
  torSnowflake: false,
  downloadAsk: false,
  downloadDir: null,
  mutedSites: [],
  siteZoom: {},
  startup: 'newtab',
  accent: '#8b8bff',
  uiScale: 1,
  density: 1,
  sidebarWidth: 252,
  pageMargin: 8,
  pageZoom: 0,
  addressSize: 1,
  urlDisplay: 'full',
  frozenBlur: 'slight',
  searchSuggestions: true,
  newTabPhoto: true,
  newTabPhotoId: null,
  newTabDither: true,
  autoHideTopBar: false,
  sidebarHover: false,
  tabLayout: 'vertical',
  fullWidthAddress: true,
  searchStyle: 'dropdown',
  paneView: 'full',
  paneViewRelease: 'stay',
  mailHandler: 'system',
  darkenSites: true,
  memorySaver: true,
  unloadIdleMin: 30,
  maxLoadedTabs: 0,
  unloadOtherSpaces: false,
  neverUnloadSites: [],
  ...YOUTUBE_DEFAULTS
}

export type AppearanceKey =
  'uiScale' | 'density' | 'sidebarWidth' | 'pageMargin' | 'addressSize' | 'pageZoom'

/** Allowed range for each appearance slider; main clamps to these too. */
export const APPEARANCE_LIMITS: Record<AppearanceKey, { min: number; max: number; step: number }> =
  {
    uiScale: { min: 0.8, max: 1.3, step: 0.05 },
    density: { min: 0.6, max: 1.3, step: 0.05 },
    sidebarWidth: { min: 200, max: 380, step: 4 },
    pageMargin: { min: 0, max: 16, step: 1 },
    addressSize: { min: 0.8, max: 1.5, step: 0.05 },
    // a Chromium zoom level: 0 is 100%, each step is 1.2 times
    pageZoom: { min: -3, max: 5, step: 0.5 }
  }

export const INTERNAL_PAGES = [
  'history',
  'bookmarks',
  'downloads',
  'passwords',
  'settings',
  'privacy',
  'software'
] as const
export type InternalPage = (typeof INTERNAL_PAGES)[number]

export const internalUrl = (page: InternalPage): string => `panes://${page}`

/** Colours offered for spaces; new spaces take the next one in turn. */
export const SPACE_COLORS = ['#6e7bff', '#2bb3a3', '#e5754c', '#d65b9a', '#8a6df0', '#d0a33a']

/** Ready-made colour pairs for a space: the space editor's presets and the welcome tour's swatches. */
export const SPACE_LOOKS: ReadonlyArray<{ name: string; color: string; color2: string | null }> = [
  { name: 'Indigo', color: '#6e7bff', color2: '#a46bff' },
  { name: 'Lagoon', color: '#2bb3a3', color2: '#4ea0ff' },
  { name: 'Sunset', color: '#e5754c', color2: '#f2b24c' },
  { name: 'Orchid', color: '#d65b9a', color2: '#7a5cff' },
  { name: 'Mint', color: '#34d399', color2: '#06b6d4' },
  { name: 'Coral', color: '#f87171', color2: '#fb923c' },
  { name: 'Violet', color: '#8a6df0', color2: null },
  { name: 'Sky', color: '#3b82f6', color2: null }
]
