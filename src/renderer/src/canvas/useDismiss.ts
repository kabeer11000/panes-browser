import { useEffect, type RefObject } from 'react'

/** How many of these menus are open now. */
let openMenus = 0
/**
 * Whether an Escape belongs to an open menu, for what is behind it (the preview) to leave alone. Either listener may
 * run first: the menu's marks the key handled, and before it has run the menu still counts as open.
 */
export const menuTook = (e: KeyboardEvent): boolean => e.defaultPrevented || openMenus > 0

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
    openMenus++
    const down = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // the menu goes, not the selection or the card behind it. Marked handled too: the preview's own Escape listens
      // on the window as well, and may run after this one, when the menu is already gone
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', close)
    return () => {
      openMenus--
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', close)
    }
  }, [open, ref, close])
}
