import { ipcRenderer } from 'electron'

const MAX_TEXT = 2000

const editable = (n: Node | null): boolean => {
  const el = n instanceof Element ? n : (n?.parentElement ?? null)
  return !!el?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
}

const box = (r: DOMRect): { x: number; y: number; width: number; height: number } => ({
  x: r.left,
  y: r.top,
  width: r.width,
  height: r.height
})

/**
 * Tells main what text is selected on the page, and where, when main asks (Ctrl+Shift+Y or the page's right-click
 * menu), so the Explain / Translate chip can sit beside it (main/askSelection.ts). Selecting alone opens nothing.
 * It runs in the preload's own world and adds nothing to the page: no element, no style. Never for a text field.
 * Main drops it for private and Tor tabs.
 */
export function installSelectionWatch(): void {
  let shown = false

  const clear = (): void => {
    if (!shown) return
    shown = false
    ipcRenderer.send('sel:report', null)
  }

  const report = (): void => {
    const sel = getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return clear()
    if (editable(sel.anchorNode) || editable(sel.focusNode) || editable(document.activeElement))
      return clear()
    const text = sel.toString().trim().slice(0, MAX_TEXT)
    const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 0 && r.height > 0)
    if (!text || rects.length === 0) return clear()
    shown = true
    ipcRenderer.send('sel:report', {
      text,
      first: box(rects[0]),
      last: box(rects[rects.length - 1])
    })
  }

  ipcRenderer.on('sel:poll', report)
  // pressing anywhere, scrolling or Esc ends the offer
  addEventListener('mousedown', clear, true)
  addEventListener('scroll', clear, { capture: true, passive: true })
  addEventListener('keydown', (e) => e.key === 'Escape' && clear(), true)
}
