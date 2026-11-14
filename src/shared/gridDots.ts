/**
 * The canvas's dotted grid under a pan and a zoom. The fine dots keep between 12 and 48 screen px apart (steps of 4,
 * as the coarse grid is 4 of them), so the density on screen stays even.
 *
 * Repainting the dots is a full-window raster (two gradients), which a software-rendered window cannot afford every
 * frame of a zoom. So the painted dots are kept and the grid layer is scaled to the true spacing, and only repainted
 * once that scale strays past MIN_SCALE..MAX_SCALE (or the spacing wraps to the next step), and when the board settles.
 */
export const MIN_SCALE = 0.75
export const MAX_SCALE = 4 / 3

/** The fine dots' spacing on screen at zoom `k`. */
export function dotStep(k: number): number {
  let ds = 24 * k
  while (ds < 12) ds *= 4
  while (ds >= 48) ds /= 4
  return ds
}

/** How visible the fine dots are at spacing `ds` (they fade out as they get dense). */
export const dotAlpha = (ds: number): number => Math.min(1, Math.max(0, (ds - 10) / 14))

export type GridPlace = {
  /** the spacing to paint at, when `repaint`; otherwise the one already painted */
  painted: number
  repaint: boolean
  /** the grid layer's transform (origin top-left) */
  scale: number
  tx: number
  ty: number
}

/**
 * Where the grid layer goes for view (x, y, k), with dots painted at spacing `painted` (NaN: nothing painted yet).
 * `exact` forces a repaint at the true spacing unless it is the painted one (the board has settled).
 *
 * The layer is laid out a coarse tile (of the painted spacing) up and left of the frame; it is moved by the pan modulo
 * one true coarse tile, so a dot always sits where it would if the grid were painted at the true spacing.
 */
export function placeGrid(
  x: number,
  y: number,
  k: number,
  painted: number,
  exact: boolean
): GridPlace {
  const ds = dotStep(k)
  const s = ds / painted
  const repaint = exact ? s !== 1 : !(s >= MIN_SCALE && s <= MAX_SCALE)
  const p = repaint ? ds : painted
  const tTrue = ds * 4
  const shift = p * 4 - tTrue
  // whole pixels: dots that land between pixels shimmer as the board moves
  const mod = (v: number): number => ((Math.round(v) % tTrue) + tTrue) % tTrue
  return { painted: p, repaint, scale: ds / p, tx: shift + mod(x), ty: shift + mod(y) }
}
