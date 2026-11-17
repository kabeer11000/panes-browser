// Which card a board movement in flight will land on, so its page can get ready before the board stops (a frozen
// page starts running, an unloaded one starts loading): by the time the hand lets go, it is there.

export interface LandingBox {
  x: number
  y: number
  w: number
  h: number
}

/** Least share of the window's width a card must fill where the board comes to rest to count as landed on. */
export const LAND_SHARE = 0.45

/**
 * The card under the middle of the window once the board rests at `v` (screen = board * k + offset), if it fills at
 * least `share` of the window's width there; of several, the one whose middle is nearest. Null when none does.
 */
export function landingCard(
  cards: ReadonlyArray<{ id: number; box: LandingBox }>,
  v: { x: number; y: number; k: number },
  screen: { w: number; h: number },
  share = LAND_SHARE
): number | null {
  if (!(v.k > 0) || screen.w <= 0 || screen.h <= 0) return null
  // the middle of the window, on the board
  const cx = (screen.w / 2 - v.x) / v.k
  const cy = (screen.h / 2 - v.y) / v.k
  let best: number | null = null
  let bestD = Infinity
  for (const { id, box: b } of cards) {
    if (b.w * v.k < screen.w * share) continue
    if (cx < b.x || cx > b.x + b.w || cy < b.y || cy > b.y + b.h) continue
    const d = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy)
    if (d < bestD) {
      bestD = d
      best = id
    }
  }
  return best
}
