import type { Rect } from '../types'

/**
 * What the canvas preview's site bar and its right-click menu offer for a page. One answer for both, so the bar
 * and the native menu never disagree.
 */
export interface PageCaps {
  /** An ordinary web page (http or https). */
  web: boolean
  /** Bookmarks are never written from a private or Tor tab. */
  bookmark: boolean
  copy: boolean
  /** Site settings (permissions, blocker, data) exist only for web origins. */
  site: boolean
  source: boolean
}

export function pageCaps(url: string | undefined, priv: boolean): PageCaps {
  const web = /^https?:\/\//i.test(url ?? '')
  return { web, bookmark: web && !priv, copy: web, site: web, source: web }
}

/**
 * The live page's box at rest: the board is measured on screen, where the hover sidebar and the pulled-out top bar
 * shift it by the slide. The main process adds the slide back to the native view itself (as for ordinary tabs), so
 * the view moves in step with the slide instead of being left where it was measured mid-slide.
 */
export function restRect(visual: Rect, slide: { x: number; y: number }): Rect {
  return {
    x: Math.round(visual.x - slide.x),
    y: Math.round(visual.y - slide.y),
    width: Math.max(0, Math.round(visual.width)),
    height: Math.max(0, Math.round(visual.height))
  }
}

export const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** A Chromium zoom level (0 is 100%, each step 1.2 times) as the percentage people know. */
export const zoomPercent = (level: number): number => Math.round(100 * Math.pow(1.2, level))

/** How many recent tabs the preview's header offers to switch to. */
export const RECENT_IN_PREVIEW = 3
/** And the board's tab strip, where no page is open. */
export const RECENT_ON_BOARD = 5

/** A tab as the recent rows see it: when it was last on screen, and when it was opened (0: restored, or unknown). */
export interface RecentTab {
  id: number
  usedAt: number
  openedAt?: number
}

/** How recent a tab is: last used, or opened if that is later (a tab opened in the background is new, not old). */
const recency = (t: RecentTab): number => Math.max(t.usedAt, t.openedAt ?? 0)

/**
 * The tabs used last, other than the one open in the preview, for the preview's header: only those with a card on
 * the board (the preview opens cards), most recent first.
 */
export function recentOthers(
  tabs: readonly RecentTab[],
  open: number,
  onBoard: (id: number) => boolean,
  n = RECENT_IN_PREVIEW
): number[] {
  return tabs
    .filter((t) => t.id !== open && onBoard(t.id))
    .sort((a, b) => recency(b) - recency(a))
    .slice(0, n)
    .map((t) => t.id)
}

/**
 * A row of tabs that holds still (the user, again and again: nothing moves under the pointer). `prev` is the row as
 * shown; `want` the tabs it should hold now, most recent first. A tab still wanted keeps its seat; one that left frees
 * its seat and the next one coming in takes that seat, not the end (the others do not slide); a tab newly opened
 * (`isNew`) joins at the left, the newest thing being there. At most `n`: the last ones make room, never `keep`.
 */
export function seated(
  prev: readonly number[],
  want: readonly number[],
  isNew: (id: number) => boolean,
  n: number,
  keep?: number
): number[] {
  if (prev.length === 0) return want.slice(0, n)
  const wanted = new Set(want)
  const seats: (number | null)[] = prev.map((id) => (wanted.has(id) ? id : null))
  const incoming = want.filter((id) => !prev.includes(id))
  const fresh = incoming.filter(isNew)
  const rest = incoming.filter((id) => !isNew(id))
  for (let i = 0; i < seats.length && rest.length > 0; i++)
    if (seats[i] === null) seats[i] = rest.shift()!
  const row = [...fresh, ...seats.filter((id): id is number => id !== null), ...rest]
  while (row.length > n) {
    const last = row.findLastIndex((id) => id !== keep)
    if (last < 0) break
    row.splice(last, 1)
  }
  return row
}

/**
 * The preview's recent tabs row (see seated): the open tab and the ones used last, each in its seat. A tab opened
 * after everything in the row was last used is the newest: it joins at the left. `left`, the page the preview was
 * just showing, always stays in the row (the way back is one click, as Ctrl+Tab's last tab), whatever the tabs' times
 * say at this moment (they reach the window a beat after the switch).
 */
export function keptRecent(
  row: readonly number[],
  tabs: readonly RecentTab[],
  open: number,
  onBoard: (id: number) => boolean,
  left?: number | null
): number[] {
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const alive = row.filter((id) => byId.has(id))
  // the open one is in use right now (its time keeps moving): the row's others say when the row was last touched
  const newest = Math.max(
    0,
    ...alive.filter((id) => id !== open).map((id) => recency(byId.get(id)!))
  )
  const isNew = (id: number): boolean => (byId.get(id)?.openedAt ?? 0) > newest
  const back = left != null && left !== open && byId.has(left) && onBoard(left) ? left : null
  const others = recentOthers(tabs, open, onBoard, RECENT_IN_PREVIEW + 1).filter(
    (id) => id !== back
  )
  const want = [open, ...(back !== null ? [back] : []), ...others].slice(0, RECENT_IN_PREVIEW + 1)
  return seated(row, want, isNew, RECENT_IN_PREVIEW + 1, open)
}

/** The board's row (no page open), held still the same way. */
export function keptBoardRow(
  row: readonly number[],
  tabs: readonly RecentTab[],
  onBoard: (id: number) => boolean
): number[] {
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const newest = Math.max(
    0,
    ...row.filter((id) => byId.has(id)).map((id) => recency(byId.get(id)!))
  )
  const isNew = (id: number): boolean => (byId.get(id)?.openedAt ?? 0) > newest
  return seated(row, recentOthers(tabs, -1, onBoard, RECENT_ON_BOARD), isNew, RECENT_ON_BOARD)
}
