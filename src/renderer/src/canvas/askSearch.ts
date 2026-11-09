import type { Anchor } from '@renderer/components/SearchPalette'

/**
 * The canvas asks the app for its search popover (the same one the address bar opens: history, open tabs,
 * suggestions), anchored where the board wants it, and gets back what was picked instead of a navigation.
 * Resolves with the address or search text, or null when it was closed without a pick.
 */
export interface CanvasSearchRequest {
  req: number
  anchor: Anchor
  /** What the field starts with (a card's address when changing it). */
  initial: string
}

let seq = 0

export function askSearch(anchor: Anchor, initial = ''): Promise<string | null> {
  const req = ++seq
  return new Promise((resolve) => {
    const done = (e: Event): void => {
      const d = (e as CustomEvent<{ req: number; text: string | null }>).detail
      if (d?.req !== req) return
      window.removeEventListener('panes:canvas-search-result', done)
      resolve(d.text)
    }
    window.addEventListener('panes:canvas-search-result', done)
    window.dispatchEvent(
      new CustomEvent<CanvasSearchRequest>('panes:canvas-search', {
        detail: { req, anchor, initial }
      })
    )
  })
}

/** A bar-shaped anchor centred on a point of the window, kept inside it. */
export function anchorAt(x: number, y: number, width = 600): Anchor {
  const w = Math.min(width, window.innerWidth - 16)
  return {
    left: Math.min(window.innerWidth - 8 - w, Math.max(8, x - w / 2)),
    top: Math.min(window.innerHeight - 60, Math.max(8, y - 22)),
    width: w,
    height: 44,
    radius: 12
  }
}

/** An anchor over an element (the preview's title, say), at least `minWidth` wide. */
export function anchorOver(el: Element, minWidth = 560): Anchor {
  const r = el.getBoundingClientRect()
  const w = Math.min(Math.max(r.width, minWidth), window.innerWidth - 16)
  return {
    left: Math.min(window.innerWidth - 8 - w, Math.max(8, r.left)),
    top: r.top + r.height / 2 - 20,
    width: w,
    height: 40,
    radius: 10
  }
}
