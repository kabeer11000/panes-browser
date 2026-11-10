// Live tab streams on canvas cards: which cards stream, how big the capture is, and where the video sits in it.
// Pure so it can be tested; main (tabs.ts) and the board (Canvas.tsx, Cards.tsx) use it.

/** A playing video's picture inside a page, as fractions of the page's viewport (0..1). */
export interface VideoRegion {
  x: number
  y: number
  w: number
  h: number
}

/**
 * How many cards may stream at once: a 4-core/8-thread laptop with 8 GB gets 2, bigger machines 4. Takes the
 * renderer's `navigator` (deviceMemory is Chromium-only, rounded and at most 8, so cores decide above that).
 */
export function streamCap(nav: { hardwareConcurrency?: number; deviceMemory?: number }): number {
  const cores = nav.hardwareConcurrency || 4
  return cores <= 8 || (nav.deviceMemory !== undefined && nav.deviceMemory < 8) ? 2 : 4
}

/** Frames per second asked of each stream: a card is small, and the page keeps its full rate for itself. */
export function streamFps(cap: number): number {
  return cap <= 2 ? 24 : 30
}

/**
 * The tabs that stream now: playing (or muted) tabs whose card is on screen, not the one open in the preview (its
 * real page is shown then), none while zoomed out to dots, at most `cap`, the ones making sound first.
 */
export function pickStreams(o: {
  tabs: Array<{ id: number; audible: boolean; muted: boolean }>
  onScreen: ReadonlySet<number>
  open: number | null
  zoomedOut: boolean
  cap: number
}): number[] {
  if (o.zoomedOut || o.cap <= 0) return []
  return o.tabs
    .filter((t) => (t.audible || t.muted) && t.id !== o.open && o.onScreen.has(t.id))
    .sort((a, b) => Number(b.audible && !b.muted) - Number(a.audible && !a.muted))
    .slice(0, o.cap)
    .map((t) => t.id)
}

const STEP = 160
const MIN_W = 320
const MAX_W = 1280

/**
 * Width to capture the page at, so the video part of it is about as sharp as the card shows it and no sharper.
 * Rounded up to steps of 160 px so zooming the board does not restart the stream on every frame.
 */
export function captureWidth(cardPx: number, dpr: number, regionW: number): number {
  const need = (cardPx * dpr) / Math.max(regionW, 0.2)
  return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(need / STEP) * STEP))
}

/**
 * The page script's answer, checked (the page could return anything): [left, top, width, height] of the <video>
 * element, the viewport size and the video's own size, all in CSS px. The picture sits letterboxed inside the
 * element (object-fit: contain), so the region is that picture, clipped to the viewport. Null when there is no
 * usable video (absent, tiny, off screen).
 */
export function videoRegion(raw: unknown): VideoRegion | null {
  if (!Array.isArray(raw) || raw.length !== 8) return null
  if (!raw.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const [left, top, width, height, vw, vh, iw, ih] = raw as number[]
  if (width <= 0 || height <= 0 || vw <= 0 || vh <= 0 || iw <= 0 || ih <= 0) return null
  const aspect = iw / ih
  const cw = Math.min(width, height * aspect)
  const ch = cw / aspect
  const x0 = Math.max(0, left + (width - cw) / 2)
  const y0 = Math.max(0, top + (height - ch) / 2)
  const x1 = Math.min(vw, left + (width + cw) / 2)
  const y1 = Math.min(vh, top + (height + ch) / 2)
  const r = { x: x0 / vw, y: y0 / vh, w: (x1 - x0) / vw, h: (y1 - y0) / vh }
  // a thumbnail-sized or mostly hidden video is not worth a stream
  return r.w > 0 && r.h > 0 && r.w * r.h >= 0.02 ? r : null
}

/**
 * Lay out the stream so only the video shows, whole, centered in the card (letterboxed): `clip` is the box the
 * video fills, in % of the card; `video` is the whole page frame inside that box, in % of the box.
 */
export function fitRegion(
  r: VideoRegion,
  frameAspect: number,
  boxAspect: number
): {
  clip: { w: number; h: number }
  video: { x: number; y: number; w: number; h: number }
} {
  const regionAspect = (r.w * frameAspect) / r.h
  const clip =
    regionAspect > boxAspect
      ? { w: 100, h: (boxAspect / regionAspect) * 100 }
      : { w: (regionAspect / boxAspect) * 100, h: 100 }
  return {
    clip,
    video: { x: (-r.x / r.w) * 100, y: (-r.y / r.h) * 100, w: 100 / r.w, h: 100 / r.h }
  }
}

/**
 * Run in the tab's page: the biggest playing <video> in view, for `videoRegion`. Main frame only; a video inside
 * a cross-site frame is not found, and that card keeps its picture.
 */
export const VIDEO_RECT_SCRIPT = `(() => {
  let best = null, area = 0
  for (const v of document.querySelectorAll('video')) {
    if (v.paused || v.readyState < 2 || !v.videoWidth || !v.videoHeight) continue
    const r = v.getBoundingClientRect()
    const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) *
      Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0))
    if (a > area) {
      area = a
      best = [r.left, r.top, r.width, r.height, innerWidth, innerHeight, v.videoWidth, v.videoHeight]
    }
  }
  return best
})()`
