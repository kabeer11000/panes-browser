import { net } from 'electron'
import { rankLocal, type LocalSuggestion } from '../shared/search'
import type { SearchEngineId } from '../shared/types'
import type { BookmarkStore, HistoryStore } from './history'
import type { SettingsStore } from './settings'

const LOCAL_LIMIT = 12
const HISTORY_WINDOW = 5000 // most recent visits considered when ranking
const REMOTE_TIMEOUT_MS = 1500
const CACHE_MAX = 80

/** Every one of these answers in OpenSearch format: [query, [suggestion, ...]]. */
const ENDPOINTS: Record<SearchEngineId, (q: string) => string> = {
  duckduckgo: (q) => `https://duckduckgo.com/ac/?type=list&q=${q}`,
  google: (q) => `https://suggestqueries.google.com/complete/search?client=firefox&q=${q}`,
  bing: (q) => `https://api.bing.com/osjson.aspx?query=${q}`,
  brave: (q) => `https://search.brave.com/api/suggest?q=${q}`
}

export class Suggester {
  private cache = new Map<string, string[]>()

  constructor(
    private deps: { history: HistoryStore; bookmarks: BookmarkStore; settings: SettingsStore }
  ) {}

  /** Pages from your own history and bookmarks. */
  local(query: string): LocalSuggestion[] {
    const history = this.deps.history.list('', HISTORY_WINDOW, 0)
    return rankLocal(query, history, this.deps.bookmarks.list(), Date.now(), LOCAL_LIMIT)
  }

  /** Suggestions from the chosen search engine. Off when the user turned suggestions off. */
  async remote(query: string): Promise<string[]> {
    const { searchSuggestions, searchEngine } = this.deps.settings.get()
    const q = query.trim()
    if (!searchSuggestions || q.length < 2 || q.length > 100) return []

    const key = `${searchEngine}:${q.toLowerCase()}`
    const hit = this.cache.get(key)
    if (hit) return hit

    try {
      const res = await net.fetch(ENDPOINTS[searchEngine](encodeURIComponent(q)), {
        signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS)
      })
      const data: unknown = await res.json()
      const list = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : []
      const out = list.filter((x): x is string => typeof x === 'string').slice(0, 8)
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string)
      this.cache.set(key, out)
      return out
    } catch {
      return [] // offline or slow: the bar still works from local results
    }
  }
}
