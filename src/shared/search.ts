import type { Bookmark, HistoryEntry, TabInfo } from './types'
import { displayHost, resolveInput } from './url'

export type ResultKind =
  'go' | 'search' | 'tab' | 'bookmark' | 'history' | 'similar' | 'suggestion' | 'action'

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
  /** Shown beside the title, as the menus show it. */
  shortcut?: string
}

/**
 * Every app action, in the order the empty command bar offers them (the first three). Each is reachable by typing part
 * of its title or a keyword. Shortcuts shown here must match main/tabs.ts handleKey (search.test.ts checks they are
 * unique). Ids not handled by the window's own UI (App.tsx onAction) go to TabManager.runAction.
 */
export const ACTIONS: SearchAction[] = [
  {
    id: 'settings',
    title: 'Open settings',
    keywords: 'settings preferences options theme',
    shortcut: 'Ctrl+,'
  },
  {
    id: 'canvas',
    title: 'Canvas view',
    keywords: 'canvas board overview tabs frames map new board',
    shortcut: 'Ctrl+Shift+K'
  },
  {
    id: 'chat',
    title: 'Open chat',
    keywords: 'chat ask ai assistant question',
    shortcut: 'Ctrl+Shift+L'
  },
  { id: 'new-tab', title: 'New tab', keywords: 'new tab open blank', shortcut: 'Ctrl+T' },
  {
    id: 'new-private',
    title: 'New private tab',
    keywords: 'private incognito window new tab',
    shortcut: 'Ctrl+Shift+N'
  },
  { id: 'new-tor', title: 'New Tor tab', keywords: 'tor onion anonymous private window new tab' },
  {
    id: 'reopen',
    title: 'Reopen closed tab',
    keywords: 'reopen restore undo closed tab',
    shortcut: 'Ctrl+Shift+T'
  },
  { id: 'close-tab', title: 'Close tab', keywords: 'close tab', shortcut: 'Ctrl+W' },
  {
    id: 'close-others',
    title: 'Close other tabs',
    keywords: 'close other tabs everything else'
  },
  {
    id: 'duplicate',
    title: 'Duplicate tab',
    keywords: 'duplicate copy clone tab'
  },
  {
    id: 'pin',
    title: 'Pin or unpin tab',
    keywords: 'pin unpin tab pinned'
  },
  {
    id: 'mute',
    title: 'Mute or unmute tab',
    keywords: 'mute unmute sound audio silence tab',
    shortcut: 'Ctrl+M'
  },
  {
    id: 'ask-selection',
    title: 'Ask about selection',
    keywords: 'ask explain translate summarise summarize selected text ai',
    shortcut: 'Ctrl+Shift+Y'
  },
  {
    id: 'reader',
    title: 'Reader mode',
    keywords: 'reader mode read article simplify clean distraction',
    shortcut: 'Ctrl+Shift+E'
  },
  { id: 'find', title: 'Find in page', keywords: 'find search text page', shortcut: 'Ctrl+F' },
  {
    id: 'bookmark',
    title: 'Bookmark this page',
    keywords: 'bookmark save star favourite favorite page',
    shortcut: 'Ctrl+D'
  },
  { id: 'reload', title: 'Reload page', keywords: 'reload refresh', shortcut: 'Ctrl+R' },
  {
    id: 'hard-reload',
    title: 'Reload ignoring cache',
    keywords: 'hard reload refresh cache',
    shortcut: 'Ctrl+Shift+R'
  },
  {
    id: 'split',
    title: 'Toggle split view',
    keywords: 'split view panes tile',
    shortcut: 'Ctrl+\\'
  },
  {
    id: 'pip',
    title: 'Picture in picture',
    keywords: 'picture pip video float window',
    shortcut: 'Alt+P'
  },
  { id: 'fullscreen', title: 'Full screen', keywords: 'fullscreen full screen', shortcut: 'F11' },
  { id: 'zoom-in', title: 'Zoom in', keywords: 'zoom in bigger larger', shortcut: 'Ctrl+=' },
  { id: 'zoom-out', title: 'Zoom out', keywords: 'zoom out smaller', shortcut: 'Ctrl+-' },
  {
    id: 'zoom-reset',
    title: 'Reset zoom',
    keywords: 'zoom reset actual size 100',
    shortcut: 'Ctrl+0'
  },
  { id: 'print', title: 'Print', keywords: 'print page pdf export', shortcut: 'Ctrl+P' },
  {
    id: 'save-pdf',
    title: 'Save page as PDF',
    keywords: 'save page pdf export document print'
  },
  { id: 'save-page', title: 'Save page as HTML', keywords: 'save page as html file download' },
  { id: 'open-file', title: 'Open file', keywords: 'open file local pdf image' },
  {
    id: 'view-source',
    title: 'View page source',
    keywords: 'view page source html code',
    shortcut: 'Ctrl+U'
  },
  {
    id: 'devtools',
    title: 'Developer tools',
    keywords: 'developer tools devtools inspect console',
    shortcut: 'F12'
  },
  {
    id: 'ai-settings',
    title: 'AI settings',
    keywords: 'ai settings model local cloud assistant titles'
  },
  { id: 'ai-setup', title: 'Set up AI', keywords: 'ai set up setup onboarding local cloud model' },
  { id: 'history', title: 'Open history', keywords: 'history recent visited', shortcut: 'Ctrl+H' },
  {
    id: 'bookmarks',
    title: 'Open bookmarks',
    keywords: 'bookmarks saved favourites favorites',
    shortcut: 'Ctrl+Shift+O'
  },
  { id: 'downloads', title: 'Open downloads', keywords: 'downloads files', shortcut: 'Ctrl+J' },
  { id: 'passwords', title: 'Open passwords', keywords: 'passwords logins credentials' },
  {
    id: 'privacy',
    title: 'Private and Tor',
    keywords: 'private tor privacy incognito page'
  },
  { id: 'software', title: 'About and updates', keywords: 'about updates version software' },
  {
    id: 'settings-search',
    title: 'Settings: search engine',
    keywords: 'settings search engine default'
  },
  {
    id: 'settings-appearance',
    title: 'Settings: appearance',
    keywords: 'settings appearance theme accent colour color dark light'
  },
  {
    id: 'settings-tabs',
    title: 'Settings: tabs layout',
    keywords: 'settings tabs layout vertical horizontal sidebar'
  },
  {
    id: 'settings-downloads',
    title: 'Settings: downloads',
    keywords: 'settings downloads folder ask where'
  },
  {
    id: 'settings-privacy',
    title: 'Settings: privacy',
    keywords: 'settings privacy tracking permissions'
  },
  {
    id: 'settings-clear-data',
    title: 'Clear browsing data',
    keywords: 'clear browsing data history cookies cache delete',
    shortcut: 'Ctrl+Shift+Delete'
  },
  {
    id: 'grid',
    title: 'Tab overview',
    keywords: 'tab overview grid task view all tabs',
    shortcut: 'Ctrl+Shift+A'
  },
  {
    id: 'stack',
    title: 'Tab stack',
    keywords: 'tab stack switch recent tabs flip',
    shortcut: 'Ctrl+Shift+Space'
  },
  { id: 'new-space', title: 'New space', keywords: 'space workspace group profile' },
  {
    id: 'sidebar',
    title: 'Toggle sidebar',
    keywords: 'sidebar hide show collapse',
    shortcut: 'Ctrl+B'
  },
  {
    id: 'save-session',
    title: 'Save all tabs as a session',
    keywords: 'save session tabs dump export'
  },
  { id: 'welcome', title: 'Welcome tour', keywords: 'welcome tour intro help' },
  { id: 'feedback', title: 'Send feedback', keywords: 'feedback bug report email' }
]

/** Actions whose title or keywords hold every typed word, the ones whose title starts with one first. */
export function matchActions(query: string, limit: number): SearchAction[] {
  const tokens = tokensOf(query)
  if (tokens.length === 0) return []
  const hits = ACTIONS.filter((a) => hasAll(`${a.title} ${a.keywords}`, tokens))
  const rank = (a: SearchAction): number =>
    a.title
      .toLowerCase()
      .split(/\W+/)
      .some((w) => w.startsWith(tokens[0]))
      ? 0
      : 1
  return hits
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map((x) => x.a)
    .slice(0, limit)
}

const MAX_TABS = 3
const MAX_ACTIONS = 5
const MAX_REMOTE = 5
const MAX_SIMILAR = 3
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
  /** Pages from history that match by meaning (AI), shown after the ones that match by letters. */
  semantic?: LocalSuggestion[]
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
  semantic = [],
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

  for (const s of semantic) {
    if (
      !q ||
      shownUrls.has(s.url) ||
      results.filter((r) => r.kind === 'similar').length >= MAX_SIMILAR
    )
      continue
    shownUrls.add(s.url)
    results.push({
      id: `similar:${s.url}`,
      kind: 'similar',
      title: s.title || displayHost(s.url),
      subtitle: displayHost(s.url),
      favicon: s.favicon,
      url: s.url
    })
  }

  // actions sit above the web's suggestions: a command you typed the name of is not buried under ten searches
  const actions = matchActions(q, MAX_ACTIONS)
  for (const a of actions) {
    results.push({
      id: `action:${a.id}`,
      kind: 'action',
      title: a.title,
      subtitle: a.shortcut,
      actionId: a.id
    })
  }
  for (const text of remote.slice(0, MAX_REMOTE)) {
    if (text.toLowerCase() === q.toLowerCase()) continue
    results.push({ id: `suggestion:${text}`, kind: 'suggestion', title: text, url: text })
  }

  if (!q) {
    for (const a of ACTIONS.slice(0, 3)) {
      results.push({
        id: `action:${a.id}`,
        kind: 'action',
        title: a.title,
        subtitle: a.shortcut,
        actionId: a.id
      })
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
    case 'similar':
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
