/**
 * The pure parts of a context menu: what it holds, where it opens, which item a typed letter jumps to, and the
 * "safe triangle" that lets the pointer cross other items on its way into a submenu.
 */

export interface MenuAction {
  /** What the menu's owner is told when it is picked. */
  id: string
  label: string
  /** The shortcut that does the same, shown on the right. */
  keys?: string
  danger?: boolean
  disabled?: boolean
  /** A choice that is on (the colour in use), shown with a check. */
  checked?: boolean
  /** A colour dot before the label: a class that sets `--fc`, or a CSS colour. */
  swatch?: { cls?: string; color?: string }
  /** A submenu. */
  items?: MenuEntry[]
}
export type MenuEntry = MenuAction | 'sep'

/** No separator first, last or twice in a row; empty submenus go. */
export function tidyMenu(items: readonly MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const x of items) {
    if (x === 'sep') {
      if (out.length && out[out.length - 1] !== 'sep') out.push(x)
    } else if (!x.items) out.push(x)
    else {
      const sub = tidyMenu(x.items)
      if (sub.length) out.push({ ...x, items: sub })
    }
  }
  while (out[out.length - 1] === 'sep') out.pop()
  return out
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

export interface Placed {
  x: number
  y: number
  /** Set when the menu is taller than the room: it scrolls inside this height. */
  maxH?: number
  /** It opens leftwards / upwards from its anchor (for the transform origin). */
  left: boolean
  up: boolean
}

/**
 * Where a menu of `size` goes in `bounds` (0,0 to w,h): candidates in order of preference, each clamped inside the
 * bounds with `margin`; the first that covers none of `avoid` (the AI dock, a live page drawn above the DOM) wins,
 * else the one covering least of them.
 */
function pick(
  cands: Array<{ x: number; y: number; left: boolean; up: boolean }>,
  size: { w: number; h: number },
  bounds: { w: number; h: number },
  avoid: readonly Rect[],
  margin: number
): Placed {
  const maxH = size.h > bounds.h - margin * 2 ? Math.max(0, bounds.h - margin * 2) : undefined
  const h = maxH ?? size.h
  const clampX = (x: number): number =>
    Math.max(margin, Math.min(x, bounds.w - size.w - margin))
  const clampY = (y: number): number => Math.max(margin, Math.min(y, bounds.h - h - margin))
  let best: Placed | null = null
  let bestCost = Infinity
  for (const c of cands) {
    const p = { x: clampX(c.x), y: clampY(c.y), left: c.left, up: c.up, maxH }
    const box = { x: p.x, y: p.y, w: size.w, h }
    const cost = avoid.reduce((n, a) => n + overlap(box, a), 0)
    if (cost < bestCost) {
      best = p
      bestCost = cost
      if (cost === 0) break
    }
  }
  return best!
}

/**
 * A context menu opened at the pointer: right and down from it, flipped left at the right edge and up at the bottom
 * (so it never covers the point it was opened at when it can help it), moved off anything in `avoid`.
 */
export function placeMenu(
  at: { x: number; y: number },
  size: { w: number; h: number },
  bounds: { w: number; h: number },
  avoid: readonly Rect[] = [],
  margin = 8
): Placed {
  const fitsRight = at.x + size.w + margin <= bounds.w
  const fitsDown = at.y + size.h + margin <= bounds.h
  const r = { x: at.x, left: false }
  const l = { x: at.x - size.w, left: true }
  const d = { y: at.y, up: false }
  const u = { y: at.y - size.h, up: true }
  const xs = fitsRight ? [r, l] : [l, r]
  const ys = fitsDown ? [d, u] : [u, d]
  const cands = xs.flatMap((x) => ys.map((y) => ({ ...x, ...y })))
  // last resorts: beside whatever is to be avoided
  for (const a of avoid) {
    cands.push({ x: a.x - size.w - margin, y: at.y, left: true, up: false })
    cands.push({ x: a.x + a.w + margin, y: at.y, left: false, up: false })
  }
  return pick(cands, size, bounds, avoid, margin)
}

/**
 * A submenu beside the row that opened it: to the right of the parent menu, its first item level with the row
 * (`pad`: the menu's own padding), flipped to the left when there is no room on the right.
 */
export function placeSubmenu(
  row: Rect,
  parent: Rect,
  size: { w: number; h: number },
  bounds: { w: number; h: number },
  avoid: readonly Rect[] = [],
  pad = 5,
  margin = 8
): Placed {
  const y = row.y - pad
  const right = { x: parent.x + parent.w - 2, y, left: false, up: false }
  const left = { x: parent.x - size.w + 2, y, left: true, up: false }
  const fitsRight = right.x + size.w + margin <= bounds.w
  return pick(fitsRight ? [right, left] : [left, right], size, bounds, avoid, margin)
}

/**
 * The item a typed `query` jumps to: the next enabled label (after `from`, wrapping) that starts with it, case and
 * accents aside. A query of one letter repeated ("ccc") cycles through the items starting with that letter. -1 when
 * nothing matches.
 */
export function typeAhead(
  labels: readonly string[],
  from: number,
  query: string,
  disabled: readonly boolean[] = []
): number {
  const norm = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
  let q = norm(query)
  if (!q) return -1
  const same = [...q].every((c) => c === q[0])
  if (same) q = q[0]
  const n = labels.length
  // a longer query stays on the current item while it still matches; one letter moves on
  const start = same ? from + 1 : Math.max(0, from)
  for (let i = 0; i < n; i++) {
    const k = (((start + i) % n) + n) % n
    if (!disabled[k] && norm(labels[k]).startsWith(q)) return k
  }
  return -1
}

type Pt = { x: number; y: number }

/** Whether `p` is inside the triangle a, b, c (edges included). */
export function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const s = (p1: Pt, p2: Pt, p3: Pt): number =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
  const d1 = s(p, a, b)
  const d2 = s(p, b, c)
  const d3 = s(p, c, a)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

/**
 * The safe triangle from where the pointer left a submenu's row to the submenu's near edge: while the pointer is in
 * it, crossing other rows does not switch submenus. `sub` is the open submenu's box.
 */
export function safeTriangle(from: Pt, sub: Rect): [Pt, Pt, Pt] {
  const nearX = from.x <= sub.x ? sub.x : sub.x + sub.w
  return [from, { x: nearX, y: sub.y }, { x: nearX, y: sub.y + sub.h }]
}
