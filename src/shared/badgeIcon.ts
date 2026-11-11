// The taskbar button's badge on Windows (an overlay icon is a picture, not a number): a red circle with the unread
// count drawn in white with a tiny pixel font, "9+" past nine. Pure: BGRA bytes, premultiplied, as Electron's
// nativeImage.createFromBitmap takes them.

const FONT: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000']
}

/** What the badge says for a count: nothing (a plain dot) for none, the digit, or "9+". */
export function badgeLabel(count: number): string {
  return count <= 0 ? '' : count > 9 ? '9+' : String(count)
}

/** A `size` x `size` badge: a soft-edged circle of `rgb` with `label` in white, centred. */
export function badgeIcon(
  label: string,
  rgb: readonly [number, number, number],
  size: number
): Uint8Array {
  const buf = new Uint8Array(size * size * 4)
  const c = (size - 1) / 2
  // which pixels are ink: each font pixel drawn as a `px` square, glyphs one font pixel apart
  const chars = [...label].filter((ch) => FONT[ch])
  const ink = new Set<number>()
  if (chars.length) {
    const cols = chars.length * 3 + (chars.length - 1)
    const px = Math.max(
      1,
      Math.floor((size * (chars.length > 1 ? 0.78 : 0.5)) / Math.max(cols, 5 * 0.75))
    )
    const w = cols * px
    const h = 5 * px
    const x0 = Math.round((size - w) / 2)
    const y0 = Math.round((size - h) / 2)
    chars.forEach((ch, k) => {
      FONT[ch].forEach((row, ry) => {
        for (let rx = 0; rx < 3; rx++) {
          if (row[rx] !== '1') continue
          const gx = x0 + (k * 4 + rx) * px
          const gy = y0 + ry * px
          for (let dy = 0; dy < px; dy++)
            for (let dx = 0; dx < px; dx++) {
              const x = gx + dx
              const y = gy + dy
              if (x >= 0 && y >= 0 && x < size && y < size) ink.add(y * size + x)
            }
        }
      })
    })
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // one pixel of falloff at the rim instead of a jagged edge
      const a = Math.max(0, Math.min(1, c + 0.5 - Math.hypot(x - c, y - c)))
      const i = (y * size + x) * 4
      const [r, g, b] = ink.has(y * size + x) ? [255, 255, 255] : rgb
      buf[i] = Math.round(b * a)
      buf[i + 1] = Math.round(g * a)
      buf[i + 2] = Math.round(r * a)
      buf[i + 3] = Math.round(255 * a)
    }
  }
  return buf
}
