import { ipcRenderer } from 'electron'

const SETTLE_MS = 350 // after the last change: a drag in progress, or Shift+arrows, is not "a selection" yet
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
 * Tells main when text is selected on the page, and where, so a chip can be offered beside it (main/askSelection.ts).
 * It runs in the preload's own world and adds nothing to the page: no element, no style. Never for a text field.
 * Main decides what to do with it, and drops it for private and Tor tabs.
 */
export function installSelectionWatch(): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let held = false // a mouse button is down: still selecting
  let shown = false

  const clear = (): void => {
    if (!shown) return
    shown = false
    ipcRenderer.send('sel:report', null)
  }

  const report = (): void => {
    timer = null
    if (held) return
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

  const soon = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(report, SETTLE_MS)
  }

  document.addEventListener('selectionchange', soon)
  // main asks for the offer now (Ctrl+Shift+Y): answer at once, not after the settle time
  ipcRenderer.on('sel:poll', () => {
    held = false
    report()
  })
  addEventListener(
    'mousedown',
    () => {
      held = true
      clear() // pressing anywhere ends the offer; a new selection brings a new one
    },
    true
  )
  addEventListener(
    'mouseup',
    () => {
      held = false
      soon()
    },
    true
  )
  addEventListener('scroll', clear, { capture: true, passive: true })
  addEventListener('keydown', (e) => e.key === 'Escape' && clear(), true)
}
