/**
 * Whether the board is moving (a pan, a fling, a zoom), for what is too heavy to keep updating while it does: the
 * videos playing live on cards hold their frame, so a pan moves still pictures and not a dozen streams being
 * composited into a moving board. Told once as movement starts and once as it settles.
 */
const SETTLE_MS = 250

const listeners = new Set<(moving: boolean) => void>()
let moving = false
let timer = 0

/** The board moved this frame (useViewport's paint). */
export function boardMoved(): void {
  if (!moving) {
    moving = true
    for (const f of listeners) f(true)
  }
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    moving = false
    for (const f of listeners) f(false)
  }, SETTLE_MS)
}

/** Hear when the board starts and stops moving; returns the way to stop listening. */
export function onBoardMotion(f: (moving: boolean) => void): () => void {
  listeners.add(f)
  return () => {
    listeners.delete(f)
  }
}
