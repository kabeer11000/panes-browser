import { useLayoutEffect, useRef, type RefObject } from 'react'
import { SpringVec, reducedMotion } from '@renderer/motion'

/** How long after a change the glider keeps re-measuring its target: rows animating in or out move it meanwhile. */
const FOLLOW_MS = 450

/**
 * The chosen-state card that glides between items instead of jumping: one element under the list, moved with
 * transforms on the shared spring to wherever the item matching `selector` is laid out. It follows the item while
 * neighbours animate in or out, and hides when there is no such item (or `hidden` says so). `key` is anything that
 * should send it on its way (the active id, the order of the items).
 */
export function useGlider(
  list: RefObject<HTMLElement | null>,
  glider: RefObject<HTMLElement | null>,
  selector: string,
  key: string,
  hidden = false
): void {
  const spring = useRef<SpringVec<'x' | 'y' | 'w' | 'h'> | null>(null)
  const placed = useRef(false)
  const aim = useRef('')
  const owner = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const el = glider.current
    const box = list.current
    if (!el || !box) return
    if (owner.current !== el) placed.current = false // a new list (another space): it starts in place
    owner.current = el
    // the spring outlives a remounted list (another space), so it paints whichever glider is current
    const paint = (v: { x: number; y: number; w: number; h: number }): void => {
      const g = owner.current
      if (!g) return
      g.style.transform = `translate3d(${v.x}px, ${v.y}px, 0)`
      g.style.width = `${v.w}px`
      g.style.height = `${v.h}px`
    }
    spring.current ??= new SpringVec({ x: 0, y: 0, w: 0, h: 0 }, 'snappy', paint, 0.2)
    const s = spring.current
    let raf = 0
    const end = performance.now() + FOLLOW_MS
    const measure = (): void => {
      const item = box.querySelector<HTMLElement>(selector)
      if (!item || hidden || item.classList.contains('floating')) {
        el.style.opacity = '0'
        placed.current = false
        return
      }
      const target = {
        x: item.offsetLeft,
        y: item.offsetTop,
        w: item.offsetWidth,
        h: item.offsetHeight
      }
      if (!placed.current || reducedMotion()) {
        s.jump(target)
        paint(target)
        placed.current = true
      } else {
        const k = `${target.x},${target.y},${target.w},${target.h}`
        if (k !== aim.current) void s.to(target)
        aim.current = k
        return void (el.style.opacity = '1')
      }
      aim.current = `${target.x},${target.y},${target.w},${target.h}`
      el.style.opacity = '1'
    }
    const follow = (): void => {
      measure()
      if (performance.now() < end) raf = requestAnimationFrame(follow)
    }
    follow()
    return () => cancelAnimationFrame(raf)
  }, [list, glider, selector, key, hidden])
}
