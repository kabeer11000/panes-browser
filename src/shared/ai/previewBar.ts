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

/**
 * The tabs used last, other than the one open in the preview, for the preview's header: only those with a card on
 * the board (the preview opens cards), most recently used first.
 */
export function recentOthers(
  tabs: readonly { id: number; usedAt: number }[],
  open: number,
  onBoard: (id: number) => boolean,
  n = RECENT_IN_PREVIEW
): number[] {
  return tabs
    .filter((t) => t.id !== open && onBoard(t.id))
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, n)
    .map((t) => t.id)
}

/**
 * The preview's recent tabs row, kept in its order while the preview is open. A tab that closes leaves its place and
 * the next most recent one joins at the end, so the row keeps its length (closing a page no longer shrinks it).
 * Opening a card that is not in the row starts it afresh.
 */
export function keptRecent(
  row: readonly number[],
  tabs: readonly { id: number; usedAt: number }[],
  open: number,
  onBoard: (id: number) => boolean
): number[] {
  const alive = row.filter((id) => tabs.some((t) => t.id === id))
  if (!alive.includes(open)) return [open, ...recentOthers(tabs, open, onBoard)]
  const more = recentOthers(
    tabs,
    open,
    (id) => onBoard(id) && !alive.includes(id),
    Math.max(0, RECENT_IN_PREVIEW + 1 - alive.length)
  )
  return [...alive, ...more]
}
