/**
 * Middle-click autoscroll, as Chrome on Windows: press the wheel on a page and move away from that point; the page
 * scrolls toward the pointer, faster the further it is. The DOM side is preload/autoscroll.ts.
 */

/** Pixels around the starting point where nothing scrolls (a hand is never still). */
export const DEAD_ZONE = 15
/** Pixels a second at the most. */
export const MAX_SPEED = 12_000

/** Pixels a second along one axis for the pointer `d` pixels from where it started (signed, as d). */
export function autoscrollSpeed(d: number): number {
  const out = Math.abs(d) - DEAD_ZONE
  if (out <= 0) return 0
  return Math.sign(d) * Math.min(MAX_SPEED, 300 * Math.pow(out / 40, 1.6))
}

/** Released this soon, without leaving the dead zone: it stays on until the next click (a click, not a hold). */
export const TOGGLE_MS = 400

/** Whether letting go of the wheel ends the scrolling (it was held and moved), or it stays on until a click. */
export const endsOnRelease = (heldMs: number, moved: boolean): boolean =>
  moved || heldMs > TOGGLE_MS
