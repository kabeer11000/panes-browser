import { useCallback, useRef, type WheelEvent } from 'react'

const THRESHOLD = 140 // accumulated wheel delta before a swipe fires
const GAP_MS = 150 // pause that ends one gesture
const COOLDOWN_MS = 450 // ignore trackpad inertia after a swipe fires

/**
 * Turns trackpad/wheel scrolling over an element into discrete swipes:
 * horizontal -> onHorizontal(+1 next / -1 previous), swipe up -> onUp.
 */
export function useSwipe(
  onHorizontal: (dir: 1 | -1) => void,
  onUp: () => void
): (e: WheelEvent) => void {
  const acc = useRef({ x: 0, y: 0, last: 0, lockUntil: 0 })

  return useCallback(
    (e: WheelEvent) => {
      const a = acc.current
      const now = performance.now()
      if (now < a.lockUntil) return
      if (now - a.last > GAP_MS) a.x = a.y = 0
      a.last = now
      a.x += e.deltaX
      a.y += e.deltaY

      if (Math.abs(a.x) > THRESHOLD && Math.abs(a.x) > Math.abs(a.y)) {
        onHorizontal(a.x > 0 ? 1 : -1)
      } else if (a.y > THRESHOLD && a.y > Math.abs(a.x)) {
        onUp()
      } else {
        return
      }
      a.x = a.y = 0
      a.lockUntil = now + COOLDOWN_MS
    },
    [onHorizontal, onUp]
  )
}
