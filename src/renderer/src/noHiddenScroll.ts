/**
 * An element whose overflow is hidden is never meant to scroll, yet Chromium scrolls it to bring a focused element or a
 * caret into view: a note added near the board's edge, or typed past it, scrolled the whole interface up, toolbar and
 * all, with no way back (no scrollbar, no wheel). Scroll events do not bubble, but they can be caught on the way down:
 * one listener puts any such element back the moment it moves. Elements that do scroll (overflow auto or scroll) are
 * left alone.
 */
export function installNoHiddenScroll(): void {
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target
      if (!(el instanceof HTMLElement)) return
      if (el.scrollTop === 0 && el.scrollLeft === 0) return
      const s = getComputedStyle(el)
      const hidden = (v: string): boolean => v === 'hidden' || v === 'clip'
      if (hidden(s.overflowY) && el.scrollTop !== 0) el.scrollTop = 0
      if (hidden(s.overflowX) && el.scrollLeft !== 0) el.scrollLeft = 0
    },
    { capture: true, passive: true }
  )
}
