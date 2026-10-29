/**
 * Where the tab being dragged will settle when it is let go, remembered by the slide hook so the drop can
 * glide the tab into that place (as Chrome does) instead of snapping it there.
 */
interface Slot {
  els: HTMLElement[]
  axis: 'x' | 'y'
  /** How far the tab sits from where it started, once it is in its new place. */
  offset: number
}

let slot: Slot | null = null

export const rememberSlot = (s: Slot | null): void => {
  slot = s
}

/** Glide the dragged tab into its slot; resolves when it has arrived. Nothing to do when nothing is remembered. */
export function settleDrag(): Promise<void> {
  const s = slot
  slot = null
  if (!s || s.els.length === 0) return Promise.resolve()
  return new Promise((resolve) => {
    for (const el of s.els) {
      el.style.transition = 'translate 0.12s cubic-bezier(0.22, 1, 0.36, 1)'
      el.style.translate = s.axis === 'x' ? `${s.offset}px 0` : `0 ${s.offset}px`
    }
    setTimeout(resolve, 125)
  })
}
