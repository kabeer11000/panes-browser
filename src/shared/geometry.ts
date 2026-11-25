import type { Rect } from './types'

/**
 * A box measured in CSS pixels (fractional) as whole pixels for a native view, always inside it: the left and top edges
 * round up, the right and bottom down. Rounding the position and the size apart could leave the view a pixel past
 * the box on either side, over the focus ring drawn just outside a split pane (the view is an opaque rectangle).
 */
export function innerRect(r: Rect): Rect {
  const x = Math.ceil(r.x - 0.01) + 0 // + 0: never -0
  const y = Math.ceil(r.y - 0.01) + 0
  return {
    x,
    y,
    width: Math.max(0, Math.floor(r.x + r.width + 0.01) - x),
    height: Math.max(0, Math.floor(r.y + r.height + 0.01) - y)
  }
}
