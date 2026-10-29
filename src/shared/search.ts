import type { Bookmark, HistoryEntry, TabInfo } from './types'
import { displayHost, resolveInput } from './url'

export type ResultKind = 'go' | 'search' | 'tab' | 'bookmark' | 'history' | 'suggestion' | 'action'

export interface SearchResult {
  id: string
  kind: ResultKind
  title: string
  subtitle?: string
  favicon?: string | null
  url?: string
  tabId?: number
  actionId?: string
}

/** A page from history or bookmarks that matches what was typed, with its ranking score. */
export interface LocalSuggestion {
  url: string
  title: string
  favicon: string | null
  bookmark: boolean
  score: number
}

export interface SearchAction {
  id: string
  title: string
  keywords: string
}

export const ACTIONS: SearchAction[] = [
  { id: 'settings', title: 'Open settings', keywords: 'settings preferences options theme' },
  { id: 'history', title: 'Open history', keywords: 'history recent visited' },
  { id: 'bookmarks', title: 'Open bookmarks', keywords: 'bookmarks saved favourites favorites' },
  { id: 'downloads', title: 'Open downloads', keywords: 'downloads files' },
  { id: 'pip', title: 'Picture in picture', keywords: 'picture pip video float window' },
  { id: 'split', title: 'Toggle split view', keywords: 'split view panes tile' },
  { id: 'new-space', title: 'New space', keywords: 'space workspace group profile' },
  { id: 'sidebar', title: 'Toggle sidebar', keywords: 'sidebar hide show collapse' }
]

const MAX_TABS = 3
const MAX_ACTIONS = 3
const MAX_REMOTE = 5
const DAY_MS = 86_400_000

const tokensOf = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean)
const hasAll = (text: string, tokens: string[]): boolean => {
  const t = text.toLowerCase()
  return tokens.every((tok) => t.includes(tok))
}

/** True when the text would be loaded as an address rather than searched for. */
export function isUrlLike(input: string): boolean {
  const probe = 'SEARCH:'
  const r = resolveInput(input, probe)
  return r !== '' && !r.startsWith(probe)
}

/**
 * Pages worth jumping to: history grouped by address, scored by how well they match and by
 * frecency (visit count and recency), with a boost for bookmarks. Empty query = most frecent.
 */
export function rankLocal(
  query: string,
  history: HistoryEntry[],
  bookmarks: Bookmark[],
  now: number,
  limit: number
): LocalSuggestion[] {
  const tokens = tokensOf(query)
  const pages = new Map<
    string,
    { title: string; favicon: string | null; visits: number; last: number; bookmark: boolean }
  >()
  for (const h of history) {
    const p = pages.get(h.url)
    if (p) {
      p.visits++
      p.last = Math.max(p.last, h.time)
      p.title ||= h.title
      p.favicon ??= h.favicon
    } else {
      pages.set(h.url, {
        title: h.title,
        favicon: h.favicon,
        visits: 1,
        last: h.time,
        bookmark: false
      })
    }
  }
  for (const b of bookmarks) {
    const p = pages.get(b.url)
    if (p) p.bookmark = true
    else
      pages.set(b.url, {
        title: b.title,
        favicon: b.favicon,
        visits: 0,
        last: b.time,
        bookmark: true
      })
  }

  const out: LocalSuggestion[] = []
  for (const [url, p] of pages) {
    const host = displayHost(url)
    const hay = `${p.title} ${url}`
    if (tokens.length > 0 && !hasAll(hay, tokens)) continue
    let match = 0
    for (const tok of tokens) {
      if (host.startsWith(tok)) match += 50
      else if (
        p.title
          .toLowerCase()
          .split(/\W+/)
          .some((w) => w.startsWith(tok))
      )
        match += 30
      else match += 10
    }
    const ageDays = (now - p.last) / DAY_MS
    const recency = 25 * Math.exp(-ageDays / 14) // fades over a couple of weeks
    const frequency = Math.log2(1 + p.visits) * 6
    const score = match + recency + frequency + (p.bookmark ? 15 : 0)
    out.push({ url, title: p.title || host, favicon: p.favicon, bookmark: p.bookmark, score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

interface BuildInput {
  query: string
  tabs: TabInfo[]
  activeId: number | null
  local: LocalSuggestion[]
  remote: string[]
  engineName: string
  maxLocal?: number
}

/**
 * Everything shown in the command bar, in order: the top action (go or search), open tabs,
 * bookmarks and history, search suggestions, then quick actions. Empty query shows where you
 * were and what you use most.
 */
export function buildResults({
  query,
  tabs,
  activeId,
  local,
  remote,
  engineName,
  maxLocal = 5
}: BuildInput): SearchResult[] {
  const q = query.trim()
  const tokens = tokensOf(q)
  const results: SearchResult[] = []
  const shownUrls = new Set<string>()

  const tabResult = (t: TabInfo): SearchResult => ({
    id: `tab:${t.id}`,
    kind: 'tab',
    title: t.title || displayHost(t.url) || 'New tab',
    subtitle: displayHost(t.url),
    favicon: t.favicon,
    tabId: t.id,
    url: t.url
  })

  if (q) {
    results.push(
      isUrlLike(q)
        ? { id: 'top:go', kind: 'go', title: q, subtitle: 'Go to address', url: q }
        : { id: 'top:search', kind: 'search', title: q, subtitle: `Search ${engineName}`, url: q }
    )
  }

  const tabMatches = tabs
    .filter((t) => t.id !== activeId || q)
    .filter((t) => t.url && (tokens.length === 0 || hasAll(`${t.title} ${t.url}`, tokens)))
    .slice(0, MAX_TABS + (q ? 0 : 3))
  for (const t of tabMatches) {
    results.push(tabResult(t))
    shownUrls.add(t.url)
  }

  for (const s of local) {
    if (
      shownUrls.has(s.url) ||
      results.filter((r) => r.kind === 'bookmark' || r.kind === 'history').length >= maxLocal
    ) {
      continue
    }
    shownUrls.add(s.url)
    results.push({
      id: `${s.bookmark ? 'bookmark' : 'history'}:${s.url}`,
      kind: s.bookmark ? 'bookmark' : 'history',
      title: s.title,
      subtitle: displayHost(s.url),
      favicon: s.favicon,
      url: s.url
    })
  }

  for (const text of remote.slice(0, MAX_REMOTE)) {
    if (text.toLowerCase() === q.toLowerCase()) continue
    results.push({ id: `suggestion:${text}`, kind: 'suggestion', title: text, url: text })
  }

  const actions = ACTIONS.filter((a) =>
    q ? hasAll(`${a.title} ${a.keywords}`, tokens) : false
  ).slice(0, MAX_ACTIONS)
  for (const a of actions) {
    results.push({ id: `action:${a.id}`, kind: 'action', title: a.title, actionId: a.id })
  }
  if (!q) {
    for (const a of ACTIONS.slice(0, 3)) {
      results.push({ id: `action:${a.id}`, kind: 'action', title: a.title, actionId: a.id })
    }
  }
  return results
}

/** Section heading for a result, or null for the top result which sits above any heading. */
export function sectionOf(kind: ResultKind): string | null {
  switch (kind) {
    case 'go':
    case 'search':
      return null
    case 'tab':
      return 'Tabs'
    case 'bookmark':
    case 'history':
      return 'Bookmarks and history'
    case 'suggestion':
      return 'Search suggestions'
    case 'action':
      return 'Actions'
  }
}

/** Finish a site name the user is typing, Chrome-style: "gith" becomes "github.com". Null if nothing fits. */
export function inlineCompletion(typed: string, local: LocalSuggestion[]): string | null {
  const t = typed.toLowerCase()
  if (t.length < 2 || /\s/.test(t)) return null
  for (const s of local) {
    const host = displayHost(s.url)
    if (host.length > t.length && host.toLowerCase().startsWith(t))
      return typed + host.slice(t.length)
  }
  return null
}
