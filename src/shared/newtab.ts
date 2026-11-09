import type { HistoryEntry } from './types'

/**
 * The smart part of a blank tab (shown only with AI on, never in private or Tor tabs): boards with something on them,
 * articles to go back to, and a site the person tends to open at this hour. All of it is worked out here from history
 * and the saved boards, on this machine; no model is asked.
 */

export interface BoardLink {
  spaceId: number
  name: string
  color: string
  /** Things placed on the board by the person: notes, pages, shapes, frames (tab cards are not counted). */
  things: number
  /** When the board was last saved (opened, moved, edited); missing in boards saved before it was kept. */
  usedAt?: number
}

export interface PageLink {
  url: string
  title: string
  favicon: string | null
}

export interface NextStep extends PageLink {
  /** What the suggestion says, e.g. "You often open github.com around now". */
  reason: string
}

export interface SmartNewTab {
  boards: BoardLink[]
  reading: PageLink[]
  next: NextStep[]
}

const DAY = 24 * 3600_000
const READING_DAYS = 7
const HABIT_DAYS = 14
const HABIT_MIN_DAYS = 3 // on this many different earlier days, within an hour of now
const MAX_READING = 3
const MAX_NEXT = 2
const MAX_BOARDS = 4

const SEARCH_PATH = /^\/(search|results|s|q)\b/i
/** A page that failed: a 404 keeps its address but is no article to go back to. */
const ERROR_TITLE = /\b(404|not found|error)\b/i

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Without fragment and trailing slash, so one page visited twice is one entry. */
const keyOf = (url: string): string => url.replace(/#.*$/, '').replace(/\/$/, '')

/**
 * A page that reads like an article: a web page with a path that carries a title (a long or hyphenated segment, or a
 * wiki page), and not a search results page or a site's front page.
 */
export function looksLikeArticle(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (SEARCH_PATH.test(u.pathname) || u.searchParams.has('q')) return false
  const parts = u.pathname.split('/').filter(Boolean)
  if (parts.length === 0) return false
  if (parts[0] === 'wiki' && parts.length > 1) return true
  return parts.some((p) => (p.match(/-/g)?.length ?? 0) >= 2 || /^[\w-]{24,}(\.html?)?$/.test(p))
}

/** Articles from the last week that are not open now, newest first, one per page. */
export function continueReading(
  history: readonly HistoryEntry[],
  openUrls: readonly string[],
  now: number
): PageLink[] {
  const open = new Set(openUrls.map(keyOf))
  const seen = new Set<string>()
  const out: PageLink[] = []
  const recent = [...history].filter((h) => now - h.time < READING_DAYS * DAY)
  recent.sort((a, b) => b.time - a.time)
  for (const h of recent) {
    const k = keyOf(h.url)
    if (seen.has(k)) continue
    seen.add(k)
    if (open.has(k) || !looksLikeArticle(h.url) || ERROR_TITLE.test(h.title)) continue
    out.push({ url: h.url, title: h.title || h.url, favicon: h.favicon })
    if (out.length === MAX_READING) break
  }
  return out
}

const dayKey = (t: number): number => Math.floor(t / DAY)

/** Minutes between two times of day, the short way round midnight. */
const clockGap = (a: Date, b: Date): number => {
  const d = Math.abs(a.getHours() * 60 + a.getMinutes() - (b.getHours() * 60 + b.getMinutes()))
  return Math.min(d, 1440 - d)
}

/**
 * Sites opened within an hour of this time of day on at least three earlier days of the last two weeks, that have not
 * been opened today and are not open now. The most regular first; each links to the page last opened there.
 */
export function habits(
  history: readonly HistoryEntry[],
  openUrls: readonly string[],
  now: number
): NextStep[] {
  const nowDate = new Date(now)
  const today = new Date(now).setHours(0, 0, 0, 0)
  const openHosts = new Set(openUrls.map(hostOf))
  const byHost = new Map<string, { days: Set<number>; today: boolean; last: HistoryEntry }>()
  for (const h of history) {
    if (now - h.time > HABIT_DAYS * DAY || h.time > now) continue
    const host = hostOf(h.url)
    if (!host || !/^https?:/i.test(h.url)) continue
    const e = byHost.get(host) ?? { days: new Set<number>(), today: false, last: h }
    if (h.time > e.last.time) e.last = h
    if (h.time >= today) e.today = true
    else if (clockGap(new Date(h.time), nowDate) <= 60) e.days.add(dayKey(h.time))
    byHost.set(host, e)
  }
  return [...byHost.entries()]
    .filter(([host, e]) => !e.today && !openHosts.has(host) && e.days.size >= HABIT_MIN_DAYS)
    .sort((a, b) => b[1].days.size - a[1].days.size || b[1].last.time - a[1].last.time)
    .slice(0, MAX_NEXT)
    .map(([host, e]) => ({
      url: e.last.url,
      title: e.last.title || host,
      favicon: e.last.favicon,
      reason: `You often open ${host} around now`
    }))
}

/** Boards with something on them: the current space's first, then the most recently used (a board never stamped last). */
export function pickBoards(boards: readonly BoardLink[], activeSpaceId: number): BoardLink[] {
  return boards
    .filter((b) => b.things > 0)
    .sort(
      (a, b) =>
        Number(b.spaceId === activeSpaceId) - Number(a.spaceId === activeSpaceId) ||
        (b.usedAt ?? 0) - (a.usedAt ?? 0)
    )
    .slice(0, MAX_BOARDS)
}
