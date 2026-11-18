/** A card's picture is redone sharper once it shows this much wider on screen than the picture is. */
export const SHARPEN_AT = 1.3
/** Rounded up to this step, so a small zoom does not ask again for a few pixels more. */
const STEP = 160
/** The widest picture asked for (a 4K screen's width). */
export const SHARP_MAX = 3840

/**
 * The width a card's picture should be retaken at, or null when the one it has is sharp enough: `shownPx` is the
 * picture's width on screen in device pixels, `havePx` the picture's own width (0: not known yet, nothing asked).
 */
export function sharpWidth(shownPx: number, havePx: number): number | null {
  if (!(havePx > 0) || !(shownPx > 0)) return null
  if (shownPx <= havePx * SHARPEN_AT) return null
  return Math.min(SHARP_MAX, Math.ceil(shownPx / STEP) * STEP)
}
