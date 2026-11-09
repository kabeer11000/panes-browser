import type { Box } from './canvas'
import type { ShapeKind } from './canvasMarks'

/**
 * Where text sits inside a shape, and how a shape grows to hold it (FigJam-like). Pure; shape-local units (0..w,
 * 0..h). The box is the largest calm rectangle inside the outline: a padded rectangle, the rectangle inscribed in an
 * ellipse, the middle of a diamond, the lower middle of a triangle, the body of a speech bubble, the shaft of an arrow.
 */

/** Space kept between the outline and the text, in board units. */
export const TEXT_PAD = 8

/** Insets as fractions of the shape's own size: [left, top, right, bottom]. */
const FRACTIONS: Record<ShapeKind, [number, number, number, number]> = {
  rect: [0, 0, 0, 0],
  rounded: [0, 0, 0, 0],
  // the rectangle inscribed in an ellipse is 1/sqrt(2) of its axes
  ellipse: [0.146, 0.146, 0.146, 0.146],
  diamond: [0.25, 0.25, 0.25, 0.25],
  // the widest band of a triangle with its apex at the top, in its lower half
  triangle: [0.25, 0.5, 0.25, 0],
  star: [0.32, 0.36, 0.32, 0.24],
  // the body above the tail (the tail is the bottom fifth)
  bubble: [0, 0, 0, 0.2],
  // the shaft, short of the head
  arrow: [0, 0.3, 0.3, 0.3]
}

export function textInset(kind: ShapeKind, w: number, h: number): Box {
  const [l, t, r, b] = FRACTIONS[kind]
  const x = w * l + TEXT_PAD
  const y = h * t + TEXT_PAD
  return {
    x,
    y,
    w: Math.max(1, w * (1 - l - r) - TEXT_PAD * 2),
    h: Math.max(1, h * (1 - t - b) - TEXT_PAD * 2)
  }
}

/** The height a shape needs so its text box holds `textH` (never less than it is now). */
export function heightFor(kind: ShapeKind, h: number, textH: number): number {
  const [, t, , b] = FRACTIONS[kind]
  const need = (textH + TEXT_PAD * 2) / Math.max(0.1, 1 - t - b)
  return need > h + 0.5 ? Math.ceil(need) : h
}

/**
 * A sticky note's font size: large while the note says little, smaller as it says more (FigJam's stickies shrink
 * their text before they grow).
 */
export function noteFontSize(text: string): number {
  const n = text.trim().length
  if (n <= 24) return 22
  if (n <= 60) return 18
  if (n <= 140) return 15
  return 13
}
