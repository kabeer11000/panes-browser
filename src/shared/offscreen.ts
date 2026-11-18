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
export type OsrModifier =
  | 'shift'
  | 'control'
  | 'alt'
  | 'meta'
  | 'isAutoRepeat'
  // which buttons are held during a move: without them a move after a click can read as a drag (a text selection)
  | 'leftButtonDown'
  | 'middleButtonDown'
  | 'rightButtonDown'

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
const MODS = new Set<string>([
  'shift',
  'control',
  'alt',
  'meta',
  'isAutoRepeat',
  'leftButtonDown',
  'middleButtonDown',
  'rightButtonDown'
])
const LIMIT = 100_000

const num = (v: unknown, lim = LIMIT): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : null

function mods(v: unknown): OsrModifier[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.filter((m): m is OsrModifier => typeof m === 'string' && MODS.has(m)).slice(0, 8)
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

/** Something dropped on an offscreen page: files (their paths) and the text or link that came with it. */
export interface OsrDrop {
  x: number
  y: number
  files: string[]
  text: string | null
  uri: string | null
}

/** Untrusted drop (from a renderer) to one safe to replay into the page, or null. At most 100 files. */
export function parseOsrDrop(raw: unknown): OsrDrop | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const x = num(r.x)
  const y = num(r.y)
  if (x === null || y === null) return null
  const files = Array.isArray(r.files)
    ? r.files
        .filter((f): f is string => typeof f === 'string' && f.length > 0 && f.length < 2048)
        .slice(0, 100)
    : []
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.length <= 100_000 ? v : null
  const text = str(r.text)
  const uri = str(r.uri)
  if (files.length === 0 && !text && !uri) return null
  return { x, y, files, text, uri }
}

/** Held buttons (a PointerEvent's or MouseEvent's `buttons` bits) as modifiers, for a move or a press. */
export function heldButtons(buttons: number): OsrModifier[] {
  const m: OsrModifier[] = []
  if (buttons & 1) m.push('leftButtonDown')
  if (buttons & 4) m.push('middleButtonDown')
  if (buttons & 2) m.push('rightButtonDown')
  return m
}

/** Presses this close in time and place count as one double (or triple) click. */
export const MULTI_CLICK_MS = 500
export const MULTI_CLICK_PX = 5

/** The click count of a press: one more than the last if it came soon enough and near enough, else 1 (at most 3). */
export function nextClickCount(
  last: { at: number; x: number; y: number; count: number; button: number } | null,
  now: { at: number; x: number; y: number; button: number }
): number {
  if (
    last &&
    last.button === now.button &&
    now.at - last.at <= MULTI_CLICK_MS &&
    Math.hypot(now.x - last.x, now.y - last.y) <= MULTI_CLICK_PX
  )
    return (last.count % 3) + 1
  return 1
}

/** A touch that moved less than this (px on screen) is a tap: a click. Past it, the finger scrolls the page. */
export const TAP_SLOP_PX = 8

/** A frame of another site inside an offscreen page (its own process), and where it is in the page (CSS px). */
export interface OsrFrame {
  session: string
  rect: { x: number; y: number; width: number; height: number } | null
}

/**
 * The frame of another site under a point of the page, or null for the page itself. Chromium's offscreen pages do not
 * pass input on to such frames (they are drawn but get no clicks), so input over one is sent to it directly. The last
 * one listed wins where they overlap (later in the page: on top).
 */
export function frameAt(frames: Iterable<OsrFrame>, x: number, y: number): OsrFrame | null {
  let hit: OsrFrame | null = null
  for (const f of frames) {
    const r = f.rect
    if (r && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) hit = f
  }
  return hit
}

/** CDP's modifier bits. */
const CDP_MODS: Partial<Record<OsrModifier, number>> = { alt: 1, control: 2, meta: 4, shift: 8 }
const CDP_BUTTONS: Partial<Record<OsrModifier, number>> = {
  leftButtonDown: 1,
  rightButtonDown: 2,
  middleButtonDown: 4
}

/**
 * A mouse or wheel input as the DevTools protocol's Input.dispatchMouseEvent, at `x`, `y` in the frame it goes to.
 * Null for what it has no event for (enter, leave: a move does the same there).
 */
export function toCdpMouse(ev: OsrInput, x: number, y: number): Record<string, unknown> | null {
  if (!('x' in ev)) return null
  let modifiers = 0
  let buttons = 0
  for (const m of ev.modifiers ?? []) {
    modifiers |= CDP_MODS[m] ?? 0
    buttons |= CDP_BUTTONS[m] ?? 0
  }
  if (ev.type === 'mouseWheel')
    // Electron's wheel delta is positive up and left; the protocol's is positive down and right
    return { type: 'mouseWheel', x, y, deltaX: -ev.deltaX, deltaY: -ev.deltaY, modifiers }
  const type =
    ev.type === 'mouseDown'
      ? 'mousePressed'
      : ev.type === 'mouseUp'
        ? 'mouseReleased'
        : ev.type === 'mouseMove'
          ? 'mouseMoved'
          : null
  if (!type) return null
  const held = buttons & 1 ? 'left' : buttons & 2 ? 'right' : buttons & 4 ? 'middle' : 'none'
  const button = type === 'mouseMoved' ? held : (ev.button ?? 'left')
  return {
    type,
    x,
    y,
    modifiers,
    buttons,
    button,
    clickCount: ev.clickCount ?? (type === 'mouseMoved' ? 0 : 1)
  }
}

/** A key from the window's typing box (preload/osr.ts) for an offscreen page, as the DOM gave it. */
export interface OsrKey {
  type: 'down' | 'up'
  /** KeyboardEvent.key: 'a', 'Enter', 'ArrowLeft'... */
  key: string
  /** KeyboardEvent.code: 'KeyA', 'Enter', 'ArrowLeft'... */
  code: string
  /** KeyboardEvent.keyCode: the Windows virtual key code. */
  keyCode: number
  location: number
  repeat: boolean
  modifiers: OsrModifier[]
}

/** Untrusted key (from a renderer) to one safe to send, or null. */
export function parseOsrKey(raw: unknown): OsrKey | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.type !== 'down' && r.type !== 'up') return null
  const key = typeof r.key === 'string' && r.key.length > 0 && r.key.length <= 32 ? r.key : null
  const code = typeof r.code === 'string' && r.code.length <= 32 ? r.code : ''
  const keyCode = num(r.keyCode, 255)
  if (!key || keyCode === null) return null
  const location = num(r.location, 3) ?? 0
  return {
    type: r.type,
    key,
    code,
    keyCode: Math.round(keyCode),
    location: Math.round(location),
    repeat: r.repeat === true,
    modifiers: mods(r.modifiers) ?? []
  }
}

/** What a key types: its character, a return for Enter; nothing for other keys or a chord with Ctrl, Alt or Meta. */
export function keyText(k: Pick<OsrKey, 'key' | 'modifiers'>): string {
  if (k.modifiers.some((m) => m === 'control' || m === 'alt' || m === 'meta')) return ''
  if (k.key === 'Enter') return '\r'
  return [...k.key].length === 1 ? k.key : ''
}

/**
 * A key as the DevTools protocol's Input.dispatchKeyEvent, which takes the DOM's own names and codes and reaches the
 * focused frame (another site's too): arrows, Enter, Tab, shortcuts and text behave as on any page.
 */
export function toCdpKey(k: OsrKey): Record<string, unknown> {
  let modifiers = 0
  for (const m of k.modifiers) modifiers |= CDP_MODS[m] ?? 0
  const text = k.type === 'down' ? keyText(k) : ''
  return {
    type: k.type === 'up' ? 'keyUp' : text ? 'keyDown' : 'rawKeyDown',
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.keyCode,
    nativeVirtualKeyCode: k.keyCode,
    location: k.location,
    autoRepeat: k.repeat,
    isKeypad: k.location === 3,
    modifiers,
    ...(text ? { text, unmodifiedText: text } : {})
  }
}

/** DOM key names that Electron's sendInputEvent knows by another name (its accelerator names). */
const ACCEL: Record<string, string> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ' ': 'Space',
  Escape: 'Esc'
}

/**
 * The same key for Electron's sendInputEvent, when the protocol cannot be used (DevTools open on the page with its own
 * connection): its accelerator name, and the character it types as a separate event (Enter's is a return).
 */
export function toElectronKeys(
  k: OsrKey
): Array<{ type: 'keyDown' | 'keyUp' | 'char'; keyCode: string; modifiers: OsrModifier[] }> {
  const name = ACCEL[k.key] ?? k.key
  if (k.type === 'up') return [{ type: 'keyUp', keyCode: name, modifiers: k.modifiers }]
  const text = keyText(k)
  return [
    { type: 'keyDown', keyCode: name, modifiers: k.modifiers },
    ...(text ? [{ type: 'char' as const, keyCode: text, modifiers: k.modifiers }] : [])
  ]
}

/** Electron's cursor names that are not CSS's own. */
const CURSOR_ALIAS: Record<string, string> = {
  hand: 'pointer',
  ibeam: 'text',
  nodrop: 'no-drop',
  'east-west-resize': 'ew-resize',
  'north-south-resize': 'ns-resize',
  'northeast-southwest-resize': 'nesw-resize',
  'northwest-southeast-resize': 'nwse-resize',
  'east-resize': 'e-resize',
  'north-resize': 'n-resize',
  'northeast-resize': 'ne-resize',
  'northwest-resize': 'nw-resize',
  'south-resize': 's-resize',
  'southeast-resize': 'se-resize',
  'southwest-resize': 'sw-resize',
  'west-resize': 'w-resize',
  'column-resize': 'col-resize'
}
/** The CSS cursors there are: Electron gives most by these very names. */
const CSS_CURSORS = new Set([
  'default',
  'pointer',
  'text',
  'wait',
  'progress',
  'help',
  'crosshair',
  'move',
  'cell',
  'copy',
  'alias',
  'context-menu',
  'vertical-text',
  'no-drop',
  'not-allowed',
  'grab',
  'grabbing',
  'zoom-in',
  'zoom-out',
  'none',
  'all-scroll',
  'col-resize',
  'row-resize',
  'n-resize',
  'e-resize',
  's-resize',
  'w-resize',
  'ne-resize',
  'nw-resize',
  'se-resize',
  'sw-resize',
  'ew-resize',
  'ns-resize',
  'nesw-resize',
  'nwse-resize'
])

/** Electron's cursor-changed type as a CSS cursor (panning ones are all-scroll; anything unknown the arrow). */
export function cssCursor(type: string): string {
  const t = CURSOR_ALIAS[type] ?? type
  if (CSS_CURSORS.has(t)) return t
  if (t.endsWith('-panning')) return 'all-scroll'
  return 'default'
}
