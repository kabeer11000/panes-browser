/**
 * Showing a tab live in a shared space (tasks/shared-spaces.md, shared browsing): the host's own Panes tab, streamed
 * to the others over WebRTC, and handed to one of them to drive. What travels, checked where it lands.
 */

/** Input from the person driving, positions as fractions of the page (0..1). */
export type RemoteInput =
  | { t: 'move' | 'down' | 'up'; x: number; y: number; b?: 'left' | 'right' | 'middle'; n?: number }
  | { t: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { t: 'key'; key: string; up: boolean; mods: Array<'shift' | 'control' | 'alt' | 'meta'> }
  | { t: 'char'; text: string }

/** What a tab shown live is, as the others are told (presence). */
export interface LiveTab {
  title: string
  url: string
}

/** Signals between a host and one viewer, through the relay (sealed there like everything else). */
export type LiveSignal =
  | { k: 'hello' }
  | { k: 'bye' }
  | { k: 'sdp'; sdp: { type: 'offer' | 'answer'; sdp: string } }
  | { k: 'ice'; c: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } }

/** Control messages on the data channel. */
export type LiveControl =
  | { k: 'ask'; name: string }
  | { k: 'granted' }
  | { k: 'denied' }
  | { k: 'revoked' }
  | { k: 'release' }
  | { k: 'input'; e: RemoteInput }
  /**
   * The watcher's picture size in device pixels: the host sends them no bigger (see `downscaleFor`). `card`: only a
   * card on their board shows it, so the host's tab keeps its own shape.
   */
  | { k: 'size'; w: number; h: number; card?: boolean }
  /**
   * Someone's pointer over the live page, host to watchers (tab capture draws none): `who` 0 is the host, else the
   * driver's relay address; x null when it left the page.
   */
  | { k: 'ptr'; who: number; x: number | null; y: number }
  /** The page's mouse cursor under the driver's pointer (a CSS cursor name), host to driver. */
  | { k: 'cur'; c: string }

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null
const MODS = new Set(['shift', 'control', 'alt', 'meta'])
const BUTTONS = new Set(['left', 'right', 'middle'])

/** An input event from the wire, checked and clamped; null for anything else. */
export function parseRemoteInput(v: unknown): RemoteInput | null {
  const o = v as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  if (o.t === 'move' || o.t === 'down' || o.t === 'up') {
    const x = num(o.x, 0, 1)
    const y = num(o.y, 0, 1)
    if (x === null || y === null) return null
    const b = typeof o.b === 'string' && BUTTONS.has(o.b) ? (o.b as 'left') : undefined
    const n = num(o.n, 1, 3)
    return { t: o.t, x, y, ...(b ? { b } : {}), ...(n !== null ? { n: Math.round(n) } : {}) }
  }
  if (o.t === 'wheel') {
    const x = num(o.x, 0, 1)
    const y = num(o.y, 0, 1)
    const dx = num(o.dx, -2000, 2000)
    const dy = num(o.dy, -2000, 2000)
    if (x === null || y === null || dx === null || dy === null) return null
    return { t: 'wheel', x, y, dx, dy }
  }
  if (o.t === 'key') {
    if (typeof o.key !== 'string' || o.key.length === 0 || o.key.length > 24) return null
    const mods = Array.isArray(o.mods)
      ? (o.mods.filter((m) => typeof m === 'string' && MODS.has(m)) as Array<'shift'>)
      : []
    return { t: 'key', key: o.key, up: o.up === true, mods }
  }
  if (o.t === 'char') {
    if (typeof o.text !== 'string' || o.text.length === 0 || o.text.length > 4) return null
    return { t: 'char', text: o.text }
  }
  return null
}

const KEYS: Record<string, string> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ' ': 'Space'
}

/** A browser key name as Electron's keyCode wants it ("ArrowLeft" -> "Left"); others as they are. */
export function electronKey(key: string): string {
  return KEYS[key] ?? key
}

/** Where a video's picture is inside its element (object-fit: contain): to turn a pointer into page fractions. */
export function videoBox(
  el: { width: number; height: number },
  video: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  if (!video.width || !video.height) return { x: 0, y: 0, width: el.width, height: el.height }
  const scale = Math.min(el.width / video.width, el.height / video.height)
  const width = video.width * scale
  const height = video.height * scale
  return { x: (el.width - width) / 2, y: (el.height - height) / 2, width, height }
}

/** STUN for finding a direct path: what a live tab uses when its relay cannot hand out its own (with TURN). */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' }
]

/**
 * How far to shrink a live tab's picture for one watcher: shown contained in a w x h box (device pixels), a frame
 * bigger than the box is wasted bandwidth and encoding. 1 (full size) when the box is as big, or the size is not
 * known; never more than 8. Small changes are rounded away so a resize does not renegotiate at every step.
 */
export function downscaleFor(src: { w: number; h: number }, box: { w: number; h: number }): number {
  if (!(src.w > 0 && src.h > 0 && box.w > 0 && box.h > 0)) return 1
  const s = Math.max(src.w / box.w, src.h / box.h)
  return s <= 1.1 ? 1 : Math.min(8, Math.round(s * 4) / 4)
}

type Rect = { x: number; y: number; width: number; height: number }
/**
 * The pointer over a tab's view, as fractions of its page: `cursor` in screen points, `content` the window's content
 * area on screen, `view` the tab's view inside it, `size` the content area's size. Null when the pointer is not over
 * the view, or the view is parked out of sight (painting in the window's corner for watchers, see main/tabs.ts).
 */
export function pointerOver(
  cursor: { x: number; y: number },
  content: { x: number; y: number },
  view: Rect,
  size: { w: number; h: number }
): { x: number; y: number } | null {
  if (view.width < 50 || view.height < 50) return null
  if (view.x + view.width / 2 > size.w || view.y + view.height / 2 > size.h) return null
  const x = (cursor.x - content.x - view.x) / view.width
  const y = (cursor.y - content.y - view.y) / view.height
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null
}

/** The size a line to a live tab tells its host (see liveLine.ts): the viewer's, else the largest card's. */
export function sizeFor(
  sizes: Array<{ w: number; h: number; card?: boolean } | null>
): { w: number; h: number; card?: boolean } | null {
  const all = sizes.filter(
    (s): s is { w: number; h: number; card?: boolean } => !!s && s.w > 0 && s.h > 0
  )
  const viewer = all.find((s) => !s.card)
  if (viewer) return { w: viewer.w, h: viewer.h }
  if (!all.length) return null
  return all.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a))
}
