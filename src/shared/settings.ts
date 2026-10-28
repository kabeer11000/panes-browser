import type { SearchEngineId, Settings } from './types'

export const SEARCH_ENGINES: Record<SearchEngineId, { name: string; url: string }> = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' }
}

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'duckduckgo',
  adblock: true,
  startup: 'newtab',
  accent: '#8b8bff',
  uiScale: 1,
  density: 1,
  sidebarWidth: 252,
  pageMargin: 8
}

export type AppearanceKey = 'uiScale' | 'density' | 'sidebarWidth' | 'pageMargin'

/** Allowed range for each appearance slider; main clamps to these too. */
export const APPEARANCE_LIMITS: Record<AppearanceKey, { min: number; max: number; step: number }> =
  {
    uiScale: { min: 0.8, max: 1.3, step: 0.05 },
    density: { min: 0.6, max: 1.3, step: 0.05 },
    sidebarWidth: { min: 200, max: 380, step: 4 },
    pageMargin: { min: 0, max: 16, step: 1 }
  }

export const INTERNAL_PAGES = ['history', 'bookmarks', 'downloads', 'settings'] as const
export type InternalPage = (typeof INTERNAL_PAGES)[number]

export const internalUrl = (page: InternalPage): string => `panes://${page}`
