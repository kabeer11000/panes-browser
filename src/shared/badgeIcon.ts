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
      Math.floor((size * (chars.length > 1 ? 0.6 : 0.4)) / Math.max(cols, 5 * 0.75))
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

/** The handset of Material Symbols' "call" (Apache 2.0), on a 24-unit grid. */
const PHONE_PATH =
  'M19.95 21q-3.125 0-6.175-1.362t-5.55-3.863t-3.862-5.55T3 4.05q0-.45.3-.75t.75-.3H8.1q.35 0 .625.238t.325.562l.65 3.5q.05.4-.025.675T9.4 8.45L6.975 10.9q.5.925 1.187 1.787t1.513 1.663q.775.775 1.625 1.438T13.1 17l2.35-2.35q.225-.225.588-.337t.712-.063l3.45.7q.35.1.575.363T21 15.9v4.05q0 .45-.3.75t-.75.3'

/**
 * The badge drawn by the window's own page, in the system font, anti-aliased at each size Windows may ask for
 * (TaskbarAttention runs this in the page and takes the PNGs it returns). The count is set well inside the circle,
 * as Windows' own badges are; a call is a handset. Evaluates to `{ [size]: dataURL }`.
 */
export function badgeScript(
  label: string,
  rgb: readonly [number, number, number],
  sizes: readonly number[],
  symbol: 'phone' | null = null
): string {
  return `(() => {
  const out = {}
  for (const s of ${JSON.stringify(sizes)}) {
    const c = document.createElement('canvas')
    c.width = c.height = s
    const g = c.getContext('2d')
    g.fillStyle = 'rgb(${rgb.join(',')})'
    g.beginPath()
    g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#fff'
    if (${JSON.stringify(symbol)} === 'phone') {
      const k = (s * 0.58) / 24
      g.translate(s / 2 - 12 * k, s / 2 - 12 * k)
      g.scale(k, k)
      g.fill(new Path2D(${JSON.stringify(PHONE_PATH)}))
    } else if (${JSON.stringify(label)}) {
      const text = ${JSON.stringify(label)}
      g.font = '600 ' + Math.round(s * (text.length > 1 ? 0.46 : 0.56)) + 'px "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'alphabetic'
      const m = g.measureText(text)
      const h = m.actualBoundingBoxAscent - m.actualBoundingBoxDescent
      g.fillText(text, s / 2, Math.round(s / 2 + h / 2))
    }
    out[s] = c.toDataURL('image/png')
  }
  return out
})()`
}
