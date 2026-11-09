import type { Box } from './canvas'

/**
 * Snapping on the canvas board while Shift is held (FigJam-like): a moved box lines up its edges or centre with
 * those of the boxes around it, else with the grid; a line keeps to steps of 45 degrees. Pure; board units.
 */

/** An alignment line: `axis` x is a vertical line at x = `at`, from y = `from` to y = `to` (and the other way round). */
export interface Guide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}
/** The gap between the moved box and a box it lines up with, measured across the line (drawn with its length). */
export interface Gap {
  axis: 'x' | 'y'
  /** The position across: for axis y (a vertical gap) the x where it is drawn. */
  at: number
  from: number
  to: number
  /** One of two equal gaps on either side of the moved box (it sits evenly between its neighbours). */
  even?: boolean
}
export interface Snap {
  dx: number
  dy: number
  guides: Guide[]
  gaps: Gap[]
}

/** The dot grid of the board (its dots are 28 units apart). */
export const SNAP_GRID = 28

const lines = (lo: number, size: number): number[] => [lo, lo + size / 2, lo + size]

/**
 * Where a box being moved snaps to: per axis the nearest edge or centre of another box within `threshold`, otherwise
 * the grid (its top-left corner on a grid point). Returns the extra move and the guides to draw.
 */
export function snapBox(box: Box, others: Box[], o: { threshold: number; grid?: number }): Snap {
  const grid = o.grid ?? SNAP_GRID
  const pick = (axis: 'x' | 'y'): { d: number; hit: boolean } => {
    const mine = axis === 'x' ? lines(box.x, box.w) : lines(box.y, box.h)
    let best = Infinity
    for (const b of others) {
      const theirs = axis === 'x' ? lines(b.x, b.w) : lines(b.y, b.h)
      for (const m of mine)
        for (const t of theirs) if (Math.abs(t - m) < Math.abs(best)) best = t - m
    }
    if (Math.abs(best) <= o.threshold) return { d: best, hit: true }
    if (grid <= 0) return { d: 0, hit: false }
    const lo = axis === 'x' ? box.x : box.y
    return { d: Math.round(lo / grid) * grid - lo, hit: false }
  }
  // evenly between the nearest neighbours on either side (in the same row, or column): wins over the edge lines
  const evenOf = (axis: 'x' | 'y'): { d: number; gaps: Gap[] } | null => {
    const lo = (b: Box): number => (axis === 'x' ? b.x : b.y)
    const len = (b: Box): number => (axis === 'x' ? b.w : b.h)
    const across = (b: Box): boolean =>
      axis === 'x'
        ? b.y < box.y + box.h && box.y < b.y + b.h
        : b.x < box.x + box.w && box.x < b.x + b.w
    let before: Box | null = null
    let after: Box | null = null
    for (const b of others) {
      if (!across(b)) continue
      if (
        lo(b) + len(b) <= lo(box) + o.threshold &&
        (!before || lo(b) + len(b) > lo(before) + len(before))
      )
        before = b
      if (lo(b) >= lo(box) + len(box) - o.threshold && (!after || lo(b) < lo(after))) after = b
    }
    if (!before || !after) return null
    const g1 = lo(box) - (lo(before) + len(before))
    const g2 = lo(after) - (lo(box) + len(box))
    if (g1 + g2 <= 0 || Math.abs(g1 - g2) > o.threshold * 2) return null
    const d = (g2 - g1) / 2
    const start = lo(box) + d
    // drawn across the middle of the moved box
    const at = axis === 'x' ? box.y + box.h / 2 : box.x + box.w / 2
    const cross: Gap['axis'] = axis
    return {
      d,
      gaps: [
        { axis: cross, at, from: lo(before) + len(before), to: start, even: true },
        { axis: cross, at, from: start + len(box), to: lo(after), even: true }
      ]
    }
  }
  const ex = evenOf('x')
  const ey = evenOf('y')
  const sx = ex ? { d: ex.d, hit: false } : pick('x')
  const sy = ey ? { d: ey.d, hit: false } : pick('y')
  const moved: Box = { ...box, x: box.x + sx.d, y: box.y + sy.d }
  const guides: Guide[] = []
  const gaps: Gap[] = [...(ex?.gaps ?? []), ...(ey?.gaps ?? [])]
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.5
  for (const axis of ['x', 'y'] as const) {
    if (!(axis === 'x' ? sx.hit : sy.hit)) continue
    const mine = axis === 'x' ? lines(moved.x, moved.w) : lines(moved.y, moved.h)
    for (const m of mine) {
      const with_ = others.filter((b) =>
        (axis === 'x' ? lines(b.x, b.w) : lines(b.y, b.h)).some((t) => near(t, m))
      )
      if (with_.length === 0) continue
      // the line runs across everything that lines up on it
      const all = [moved, ...with_]
      const from = Math.min(...all.map((b) => (axis === 'x' ? b.y : b.x)))
      const to = Math.max(...all.map((b) => (axis === 'x' ? b.y + b.h : b.x + b.w)))
      if (!guides.some((g) => g.axis === axis && near(g.at, m)))
        guides.push({ axis, at: m, from, to })
      // the gap to the nearest of them, across the line
      let gap: Gap | null = null
      for (const b of with_) {
        const [a0, a1, b0, b1] =
          axis === 'x'
            ? [moved.y, moved.y + moved.h, b.y, b.y + b.h]
            : [moved.x, moved.x + moved.w, b.x, b.x + b.w]
        const g = b1 <= a0 ? { from: b1, to: a0 } : a1 <= b0 ? { from: a1, to: b0 } : null
        if (g && g.to - g.from > 0 && (!gap || g.to - g.from < gap.to - gap.from))
          gap = { axis: axis === 'x' ? 'y' : 'x', at: m, ...g }
      }
      if (gap && !gaps.some((x) => x.axis === gap!.axis && near(x.from, gap!.from))) gaps.push(gap)
    }
  }
  return { dx: sx.d, dy: sy.d, guides, gaps }
}

/** A point moved so the line from `from` to it keeps to steps of `step` degrees (same length). */
export function snapAngle(
  from: { x: number; y: number },
  to: { x: number; y: number },
  step = 45
): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { ...to }
  const r = (step * Math.PI) / 180
  const a = Math.round(Math.atan2(dy, dx) / r) * r
  // along an axis or a diagonal the projection keeps the pointer's reach on that line
  const proj = dx * Math.cos(a) + dy * Math.sin(a)
  const x = from.x + Math.cos(a) * proj
  const y = from.y + Math.sin(a) * proj
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
}

/** A box resized from a fixed corner keeps the proportions of `start`. */
export function keepAspect(start: Box, next: Box, anchor: { x: number; y: number }): Box {
  if (start.w <= 0 || start.h <= 0) return next
  const ratio = start.w / start.h
  let w = next.w
  let h = next.h
  if (w / h > ratio) h = w / ratio
  else w = h * ratio
  const x = anchor.x <= next.x ? anchor.x : anchor.x - w
  const y = anchor.y <= next.y ? anchor.y : anchor.y - h
  return { x, y, w, h }
}
