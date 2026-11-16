/** Below this window width (CSS px) the pinned sidebar tucks away, so the page keeps a usable width. */
export const NARROW_W = 900

export interface NarrowState {
  narrow: boolean
  /** The sidebar was put away by the window getting narrow (not by the person), so it comes back when wide. */
  tucked: boolean
}

/**
 * The window's width changed: what the pinned sidebar does. `open` is whether it is open now (and pinned, not
 * brought out by the pointer). A sidebar the person opened or closed while narrow is theirs: it is not undone.
 */
export function narrowStep(
  prev: NarrowState,
  width: number,
  open: boolean
): { next: NarrowState; sidebar: 'close' | 'open' | null } {
  const narrow = width < NARROW_W
  if (narrow === prev.narrow) return { next: prev, sidebar: null }
  if (narrow) {
    return open
      ? { next: { narrow, tucked: true }, sidebar: 'close' }
      : { next: { narrow, tucked: false }, sidebar: null }
  }
  // wide again: only a sidebar this tucked away comes back, and only if it is still closed
  const back = prev.tucked && !open
  return { next: { narrow, tucked: false }, sidebar: back ? 'open' : null }
}
