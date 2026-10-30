/**
 * A photo as two tones, dithered: each pixel is either ink or paper, and how many of each in a patch is what makes it
 * look like the photo (the ordered "Bayer" way, so it has the regular print-like grain, not noise). Pure, so it is tested
 * and so a change of space colour can redo only the last step.
 */

export type RGB = readonly [number, number, number]

const FALLBACK: RGB = [110, 123, 255]

/** #rgb or #rrggbb. */
export function parseColor(text: string | null | undefined): RGB | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((text ?? '').trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** `t` of the way from a to b, per channel. */
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t)
]

const BLACK: RGB = [0, 0, 0]
const WHITE: RGB = [255, 255, 255]

export const luminanceOf = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/**
 * The two tones for a space: ink is its colour taken nearly to black, paper is its second colour (or, with only one,
 * the first, lightened) taken a little toward white. Always dark ink on lighter paper, whatever the colours are.
 */
export function duotone(
  color: string | null | undefined,
  color2: string | null | undefined
): { ink: RGB; paper: RGB } {
  const c = parseColor(color) ?? FALLBACK
  const c2 = parseColor(color2)
  const ink = mix(c, BLACK, 0.86)
  let paper = c2 ? mix(c2, WHITE, 0.25) : mix(c, WHITE, 0.35)
  // a very dark space colour would give paper no lighter than ink: lift it until the picture reads
  while (luminanceOf(paper) < luminanceOf(ink) + 90 && paper[0] + paper[1] + paper[2] < 740) {
    paper = mix(paper, WHITE, 0.25)
  }
  return { ink, paper }
}

/** 8 x 8 Bayer matrix, 0 to 63: the thresholds a pixel's brightness is compared with, by its place on the grid. */
export const BAYER8: readonly number[] = (() => {
  let m: number[][] = [[0]]
  for (let size = 1; size < 8; size *= 2) {
    const next: number[][] = Array.from({ length: size * 2 }, () =>
      new Array<number>(size * 2).fill(0)
    )
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = m[y][x] * 4
        next[y][x] = v
        next[y][x + size] = v + 2
        next[y + size][x] = v + 3
        next[y + size][x + size] = v + 1
      }
    }
    m = next
  }
  return m.flat()
})()

/** Brightness, 0 to 255, of each pixel of RGBA data. */
export function lumaOf(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.floor(rgba.length / 4))
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.round(0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2])
  }
  return out
}

/**
 * The brightness range worth using: the 3rd to the 97th percentile, so one burnt-out sky or black corner does not leave
 * the rest of the picture in a few greys. A flat picture gets a range of 1, not 0.
 */
export function levelsOf(luma: Uint8Array): { lo: number; hi: number } {
  const hist = new Uint32Array(256)
  for (const v of luma) hist[v]++
  const at = (fraction: number): number => {
    let seen = 0
    const goal = luma.length * fraction
    for (let v = 0; v < 256; v++) {
      seen += hist[v]
      if (seen >= goal) return v
    }
    return 255
  }
  const lo = at(0.03)
  return { lo, hi: Math.max(lo + 1, at(0.97)) }
}

/**
 * The dithered picture as RGBA: a pixel is paper where its stretched brightness beats the matrix's threshold for its
 * place, ink where it does not. A touch of contrast first, which suits the look.
 */
export function ditherDuotone(
  luma: Uint8Array,
  width: number,
  height: number,
  tones: { ink: RGB; paper: RGB },
  levels: { lo: number; hi: number }
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4)
  const span = levels.hi - levels.lo
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const n = Math.min(1, Math.max(0, (luma[i] - levels.lo) / span))
      const lit = Math.min(1, Math.max(0, (n - 0.5) * 1.2 + 0.5))
      const on = lit > (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64
      const c = on ? tones.paper : tones.ink
      out[i * 4] = c[0]
      out[i * 4 + 1] = c[1]
      out[i * 4 + 2] = c[2]
      out[i * 4 + 3] = 255
    }
  }
  return out
}
