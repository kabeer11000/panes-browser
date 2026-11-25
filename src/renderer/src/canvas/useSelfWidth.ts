import { useCallback, useRef } from 'react'

/**
 * A ref callback that keeps an element's own width in its `--self-w`, for CSS that places it by its size (see
 * .cv.docked in ask.css: a centred bar that slides aside only as far as it must to clear the side panel). A callback,
 * so an element that comes and goes (the tab strip) is measured each time it is put on screen.
 */
export function useSelfWidth<T extends HTMLElement>(): (el: T | null) => void {
  const ro = useRef<ResizeObserver | null>(null)
  return useCallback((el: T | null) => {
    ro.current?.disconnect()
    ro.current = null
    if (!el) return
    const set = (): void => el.style.setProperty('--self-w', `${Math.round(el.offsetWidth)}px`)
    set()
    ro.current = new ResizeObserver(set)
    ro.current.observe(el)
  }, [])
}
