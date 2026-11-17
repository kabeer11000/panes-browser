// Offscreen pages (main/offscreenPage.ts, preload/osr.ts): the messages between them and the input mapping. Pure.

/** Where an offscreen page is and how it looks, main -> the window's page. `gone`: it was closed. */
export interface OsrPlace {
  /** Its webContents id: frames carry it. */
  id: number
  /** The tab it shows: the board's own canvas for it is `[data-osr-tab="<tab>"]`. */
  tab?: number | null
  rect?: { x: number; y: number; width: number; height: number }
  visible?: boolean
  radius?: number
  background?: string
  gone?: boolean
}

export type OsrMouseType = 'mouseDown' | 'mouseUp' | 'mouseMove' | 'mouseEnter' | 'mouseLeave'
export type OsrKeyType = 'keyDown' | 'keyUp' | 'char'
export type OsrModifier = 'shift' | 'control' | 'alt' | 'meta' | 'isAutoRepeat'

/** An input event for Electron's sendInputEvent, checked: what the page's frame may ask for and nothing else. */
export type OsrInput =
  | {
      type: OsrMouseType
      x: number
      y: number
      button?: 'left' | 'middle' | 'right'
      clickCount?: number
      modifiers?: OsrModifier[]
    }
  | {
      type: 'mouseWheel'
      x: number
      y: number
      deltaX: number
      deltaY: number
      modifiers?: OsrModifier[]
    }
  | { type: OsrKeyType; keyCode: string; modifiers?: OsrModifier[] }

const MOUSE = new Set<string>(['mouseDown', 'mouseUp', 'mouseMove', 'mouseEnter', 'mouseLeave'])
const KEYS = new Set<string>(['keyDown', 'keyUp', 'char'])
const BUTTONS = new Set<string>(['left', 'middle', 'right'])
const MODS = new Set<string>(['shift', 'control', 'alt', 'meta', 'isAutoRepeat'])
const LIMIT = 100_000

const num = (v: unknown, lim = LIMIT): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : null

function mods(v: unknown): OsrModifier[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.filter((m): m is OsrModifier => typeof m === 'string' && MODS.has(m)).slice(0, 5)
}

/** Untrusted input (it comes from a renderer) to an event safe to send, or null. */
export function parseOsrInput(raw: unknown): OsrInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = r.type
  if (typeof type !== 'string') return null
  if (MOUSE.has(type) || type === 'mouseWheel') {
    const x = num(r.x)
    const y = num(r.y)
    if (x === null || y === null) return null
    if (type === 'mouseWheel') {
      const dx = num(r.deltaX, 10_000) ?? 0
      const dy = num(r.deltaY, 10_000) ?? 0
      return { type, x, y, deltaX: dx, deltaY: dy, modifiers: mods(r.modifiers) }
    }
    const button =
      typeof r.button === 'string' && BUTTONS.has(r.button)
        ? (r.button as 'left' | 'middle' | 'right')
        : undefined
    const clicks = num(r.clickCount, 3)
    return {
      type: type as OsrMouseType,
      x,
      y,
      ...(button ? { button } : {}),
      ...(clicks !== null && clicks >= 1 ? { clickCount: Math.round(clicks) } : {}),
      modifiers: mods(r.modifiers)
    }
  }
  if (KEYS.has(type)) {
    const k = r.keyCode
    // a key name (Enter, ArrowLeft, F5) or one character of text, however many code units it takes
    if (typeof k !== 'string' || k.length === 0 || k.length > 24) return null
    return { type: type as OsrKeyType, keyCode: k, modifiers: mods(r.modifiers) }
  }
  return null
}

/**
 * A point on the page's canvas as drawn now (its box on screen, whatever transform the board gives it) to the page's
 * own coordinates (CSS px of a page `page.width` by `page.height`). Rounded, as Chromium takes whole pixels.
 */
export function toPagePoint(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  page: { width: number; height: number }
): { x: number; y: number } {
  const fx = box.width > 0 ? (clientX - box.left) / box.width : 0
  const fy = box.height > 0 ? (clientY - box.top) / box.height : 0
  return { x: Math.round(fx * page.width), y: Math.round(fy * page.height) }
}

/** A DOM wheel delta (px, lines or pages) to Chromium's wheel units: px, positive is up and left. */
export function wheelDelta(delta: number, mode: number): number {
  const px = mode === 1 ? delta * 40 : mode === 2 ? delta * 800 : delta
  return -px
}

/** How long after the last input a page draws at the display's full rate. */
export const ACTIVE_MS = 1500
/** Frames a second for a page nobody is using (its animations, a ticker): half of a 60 Hz display. */
export const IDLE_FPS = 30

/**
 * Frames a second for an offscreen page: the display's rate while it is being used (input within ACTIVE_MS) or plays
 * media, IDLE_FPS otherwise. Every frame is a whole texture drawn again in the window, so a page that animates while
 * nobody is using it (Wikipedia redraws about 38 times a second at rest) costs half as much this way.
 */
export function osrFrameRate(o: {
  displayHz: number
  sinceInputMs: number
  media: boolean
}): number {
  const hz = o.displayHz > 0 ? Math.round(o.displayHz) : 60
  return o.media || o.sinceInputMs < ACTIVE_MS ? hz : Math.min(hz, IDLE_FPS)
}
