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

/** STUN for finding a direct path; TURN (relaying when none is found) is phase 7's next step. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' }
]
