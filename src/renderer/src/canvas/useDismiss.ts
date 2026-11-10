import { useEffect, type RefObject } from 'react'

/**
 * A small open menu closes like any menu: a press anywhere outside `ref` (on the board, another control, the page),
 * Escape, or the window losing focus. Listens only while it is open.
 */
export function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  close: () => void
): void {
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // the menu goes, not the selection or the card behind it
      e.stopPropagation()
      close()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', close)
    }
  }, [open, ref, close])
}
