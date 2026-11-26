/**
 * The board panning on its own while something is dragged to its edge (cards, notes, sections, drawings, a
 * selection box, a connector, a resize), the way Figma's canvas does. Pure: Canvas.tsx steps it once a frame and pans
 * the board by what it returns.
 *
 * Near an edge (or past it, the pointer outside the board) the board moves that way. How fast grows with how deep the
 * pointer is in the edge zone, and with how long it has been held there (it starts slow, so a drop near the edge does
 * not send the board off, and speeds up to cross a big board). The speed eases toward that, so it picks up smoothly
 * and glides to a stop when the pointer comes away from the edge.
 */

/** The edge zone, px inside the board's edge. */
export const EDGE_ZONE_PX = 56
/** Past the edge the pointer pushes harder, up to this depth (1 is the edge itself). */
const MAX_DEPTH = 1.5
/** Speed at the edge itself once fully sped up, px/s. */
const EDGE_SPEED = 1500
/** How sharply the speed grows with depth: gentle at the zone's inner side, quick at the edge. */
const DEPTH_CURVE = 1.6
/** Held at an edge: the speed starts at this share of its full value... */
const START_SHARE = 0.25
/** ...and reaches the full value after this long held there, ms. */
const RAMP_MS = 800
/** How quickly the speed follows its target (time constant, ms): the acceleration and the glide out. */
const EASE_MS = 90
/** Slower than this with nothing pushing it: stopped. */
const REST_PX_S = 4
/** Frames longer than this (a stall, a hidden window) count as this long, so the board never jumps. */
const MAX_DT_MS = 50

export interface EdgePanState {
  /** px/s; positive: the pointer is at the right (bottom) edge, the board shows more of what is that way. */
  vx: number
  vy: number
  /** How long the pointer has been in an edge zone, ms (0 when it is not). */
  held: number
}

export const EDGE_PAN_REST: EdgePanState = { vx: 0, vy: 0, held: 0 }

export interface EdgeRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** How deep `p` is in the zone at the low (`lo`) or high (`hi`) edge: negative toward lo, positive toward hi. */
function depth(p: number, lo: number, hi: number, zone: number): number {
  const z = Math.min(zone, (hi - lo) / 3) // a small board keeps a middle where nothing pans
  if (z <= 0) return 0
  if (p < lo + z) return -Math.min(MAX_DEPTH, (lo + z - p) / z)
  if (p > hi - z) return Math.min(MAX_DEPTH, (p - (hi - z)) / z)
  return 0
}

const speedAt = (d: number, ramp: number): number =>
  Math.sign(d) * EDGE_SPEED * Math.pow(Math.abs(d), DEPTH_CURVE) * ramp

/**
 * One frame: where the pointer is (`x`, `y`, the same coordinates as `r`), the board's rect, and the time since the
 * last frame. Returns the new state; the board moves by (vx, vy) * dt / 1000 px this frame.
 */
export function stepEdgePan(
  s: EdgePanState,
  x: number,
  y: number,
  r: EdgeRect,
  dtMs: number,
  zone = EDGE_ZONE_PX
): EdgePanState {
  const dt = Math.min(MAX_DT_MS, Math.max(0, dtMs))
  const dx = depth(x, r.left, r.right, zone)
  const dy = depth(y, r.top, r.bottom, zone)
  const pushing = dx !== 0 || dy !== 0
  const held = pushing ? s.held + dt : 0
  const ramp = START_SHARE + (1 - START_SHARE) * Math.min(1, held / RAMP_MS)
  const a = 1 - Math.exp(-dt / EASE_MS)
  const ease = (v: number, target: number): number => {
    const next = v + (target - v) * a
    return target === 0 && Math.abs(next) < REST_PX_S ? 0 : next
  }
  return { vx: ease(s.vx, speedAt(dx, ramp)), vy: ease(s.vy, speedAt(dy, ramp)), held }
}

/** The pointer is in an edge zone (or past an edge): the board would start to move. */
export const atEdge = (x: number, y: number, r: EdgeRect, zone = EDGE_ZONE_PX): boolean =>
  depth(x, r.left, r.right, zone) !== 0 || depth(y, r.top, r.bottom, zone) !== 0

/** Still moving, or about to: the frame loop keeps running. */
export const edgePanActive = (s: EdgePanState): boolean => s.vx !== 0 || s.vy !== 0 || s.held > 0
