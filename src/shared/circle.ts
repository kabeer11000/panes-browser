/**
 * Circle to search: the pure parts. A lasso drawn over a frozen picture of the page (main/circle.ts) becomes a polygon
 * in the page's CSS pixels; the page's own text inside it is read straight from the DOM (exact, instant, local), and
 * the picture inside its box can go to Google Lens.
 */

export interface Pt {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The smallest box around the points. */
export function boxOf(pts: readonly Pt[]): Box {
  if (pts.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** A stroke this small is a tap: it picks the thing under it rather than drawing round something. */
export const TAP_PX = 10

export const isTap = (pts: readonly Pt[]): boolean => {
  const b = boxOf(pts)
  return b.width < TAP_PX && b.height < TAP_PX
}

/** The four corners of a box, as a polygon. */
export const boxPolygon = (b: Box): Pt[] => [
  { x: b.x, y: b.y },
  { x: b.x + b.width, y: b.y },
  { x: b.x + b.width, y: b.y + b.height },
  { x: b.x, y: b.y + b.height }
]

/** Points scaled by `k` (screen pixels to the page's CSS pixels: 1 / its zoom). */
export const scalePts = (pts: readonly Pt[], k: number): Pt[] =>
  pts.map((p) => ({ x: p.x * k, y: p.y * k }))

/** Whether `p` is inside the polygon (even-odd rule, so a loop drawn twice round still works). */
export function inPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside
  }
  return inside
}

/** At most this much text is taken from a circled region. */
export const REGION_TEXT_MAX = 4000

/**
 * Runs inside the page (an isolated world, so the page cannot see or change it): the text of the words whose middle
 * is inside `poly` (CSS pixels of the viewport), in reading order. A tap (`tap`) picks the element under the point
 * instead and returns its box, so the caller can circle that.
 * ponytail: top document only; text inside iframes and closed shadow roots is not read (Lens still sees it).
 */
export function regionTextInPage(
  poly: Pt[],
  tap: Pt | null,
  max: number
): { text: string; box: Box | null; media?: boolean } {
  const inside = (p: Pt): boolean => {
    let hit = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]
      const b = poly[j]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
        hit = !hit
    }
    return hit
  }
  if (tap) {
    let el = document.elementFromPoint(tap.x, tap.y)
    const media = el?.closest('img, video, canvas, svg, picture, figure')
    if (media) el = media
    // a bare text run is too small to be "the thing": take the block it is in
    while (el && el.parentElement && el.getBoundingClientRect().width < 60) el = el.parentElement
    if (!el) return { text: '', box: null }
    const r = el.getBoundingClientRect()
    const box = { x: r.left, y: r.top, width: r.width, height: r.height }
    poly = [
      { x: r.left, y: r.top },
      { x: r.right, y: r.top },
      { x: r.right, y: r.bottom },
      { x: r.left, y: r.bottom }
    ]
    const text = regionTextInPage(poly, null, max).text
    const alt = media instanceof HTMLImageElement ? media.alt.trim() : ''
    return { text: text || alt, box, media: !!media }
  }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of poly) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  const out: string[] = []
  let size = 0
  const walker = document.createTreeWalker(
    document.body ?? document.documentElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (n) => {
        const el = n.parentElement
        if (!el || !n.textContent?.trim()) return NodeFilter.FILTER_REJECT
        if (el.closest('script, style, noscript, template')) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
    }
  )
  const range = document.createRange()
  let lastBlock: Element | null = null
  for (let n = walker.nextNode(); n && size < max; n = walker.nextNode()) {
    range.selectNodeContents(n)
    const r = range.getBoundingClientRect()
    if (r.right < x0 || r.left > x1 || r.bottom < y0 || r.top > y1 || r.width === 0) continue
    const s = n.textContent ?? ''
    const words: string[] = []
    for (const m of s.matchAll(/\S+/g)) {
      range.setStart(n, m.index)
      range.setEnd(n, m.index + m[0].length)
      const w = range.getBoundingClientRect()
      if (w.width > 0 && inside({ x: w.left + w.width / 2, y: w.top + w.height / 2 }))
        words.push(m[0])
    }
    if (words.length === 0) continue
    const block =
      n.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, div, pre, blockquote') ??
      null
    const piece = words.join(' ')
    // pieces of one sentence come from separate text nodes (a link, a bold word): a space between them, except
    // before punctuation that hugs the word in front ("Japan's", "Honshu.")
    const sep =
      out.length === 0
        ? ''
        : lastBlock && block !== lastBlock
          ? '\n'
          : /^[,.;:!?)'’%\]]/.test(piece)
            ? ''
            : ' '
    out.push(sep + piece)
    lastBlock = block
    size += piece.length + 1
  }
  range.detach()
  const text = out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
  return { text, box: null }
}

/** One multipart/form-data body with a single file field (what Google Lens's upload takes). */
export function multipartFile(
  field: string,
  filename: string,
  type: string,
  bytes: Uint8Array,
  boundary: string
): Uint8Array {
  const enc = new TextEncoder()
  const head = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${type}\r\n\r\n`
  )
  const tail = enc.encode(`\r\n--${boundary}--\r\n`)
  const out = new Uint8Array(head.length + bytes.length + tail.length)
  out.set(head, 0)
  out.set(bytes, head.length)
  out.set(tail, head.length + bytes.length)
  return out
}

/** Where a picture is sent to be searched. The answer is a redirect to the results page. */
export const LENS_UPLOAD = 'https://lens.google.com/v3/upload?hl=en&ep=ccm'
