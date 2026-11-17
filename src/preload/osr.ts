import { ipcRenderer, sharedTexture } from 'electron'
import { toPagePoint, wheelDelta, type OsrModifier, type OsrPlace } from '@shared/offscreen'

/**
 * Offscreen pages (main/offscreenPage.ts) drawn in this window. Each page's frames come as GPU shared textures and are
 * drawn into a <canvas>: the board's own, when it has put one for that tab in its layout
 * (`<canvas data-osr-tab="<id>">`, so the page scales and moves with the board), else one of this module's, laid over
 * the window at the page's rect the way a native view would be.
 *
 * It runs in the preload's isolated world: the canvases are shared DOM, frames never cross into the page's world.
 * Input on a canvas is mapped through whatever transform it has now and sent to the page (osr:input).
 */

interface Surface {
  id: number
  tab: number | null
  rect: { x: number; y: number; width: number; height: number }
  visible: boolean
  radius: number
  background: string
  /** This module's canvas, over the window. */
  own: HTMLCanvasElement
  /** The canvas drawn into now: the board's, or `own`. */
  into: HTMLCanvasElement
  ctx: CanvasRenderingContext2D | null
  /** The newest frame not drawn yet. */
  pending: VideoFrame | null
  /** The last frame drawn, so a canvas the board puts in place later shows the page at once. */
  last: VideoFrame | null
}

const surfaces = new Map<number, Surface>()
let layer: HTMLDivElement | null = null
let raf = 0

function ensureLayer(): HTMLDivElement {
  if (layer && layer.isConnected) return layer
  layer = document.createElement('div')
  layer.setAttribute('data-osr-layer', '')
  layer.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483000;contain:strict;overflow:hidden'
  document.documentElement.appendChild(layer)
  return layer
}

function boardCanvas(tab: number | null): HTMLCanvasElement | null {
  if (tab === null) return null
  return document.querySelector<HTMLCanvasElement>(`canvas[data-osr-tab="${tab}"]`)
}

/** Point the surface at the board's canvas when there is one, else at its own over the window. */
function retarget(s: Surface): void {
  const board = boardCanvas(s.tab)
  const into = board ?? s.own
  if (into !== s.into) {
    s.into = into
    s.ctx = null
    if (board) wire(board, s)
    if (s.last) s.pending ??= s.last.clone()
  }
  const ownShown = !board && s.visible
  s.own.style.display = ownShown ? 'block' : 'none'
  if (ownShown) {
    const r = s.rect
    s.own.style.transform = `translate(${r.x}px, ${r.y}px)`
    s.own.style.width = `${r.width}px`
    s.own.style.height = `${r.height}px`
    s.own.style.borderRadius = `${s.radius}px`
    s.own.style.background = s.background
  }
}

function draw(): void {
  raf = 0
  for (const s of surfaces.values()) {
    if (!s.pending) continue
    // the board may have put (or taken away) its canvas since the last frame
    retarget(s)
    const f = s.pending
    s.pending = null
    const c = s.into
    if (c.width !== f.displayWidth || c.height !== f.displayHeight) {
      c.width = f.displayWidth
      c.height = f.displayHeight
      s.ctx = null
    }
    s.ctx ??= c.getContext('2d', { alpha: false, desynchronized: true })
    s.ctx?.drawImage(f, 0, 0)
    s.last?.close()
    s.last = f
  }
}

const schedule = (): void => {
  if (!raf) raf = requestAnimationFrame(draw)
}

const mods = (e: MouseEvent | KeyboardEvent): OsrModifier[] => {
  const m: OsrModifier[] = []
  if (e.shiftKey) m.push('shift')
  if (e.ctrlKey) m.push('control')
  if (e.altKey) m.push('alt')
  if (e.metaKey) m.push('meta')
  if ('repeat' in e && e.repeat) m.push('isAutoRepeat')
  return m
}
const BUTTON = ['left', 'middle', 'right'] as const
const wired = new WeakSet<HTMLCanvasElement>()

/** Input on a canvas goes to its page; the surface is looked up per event (a board canvas can change pages). */
function wire(c: HTMLCanvasElement, first: Surface): void {
  if (wired.has(c)) return
  wired.add(c)
  c.tabIndex = 0
  const surface = (): Surface | null => {
    const tab = c.getAttribute('data-osr-tab')
    if (tab === null) return surfaces.get(first.id) ?? null
    for (const s of surfaces.values()) if (String(s.tab) === tab) return s
    return null
  }
  const send = (s: Surface, ev: Record<string, unknown>): void =>
    ipcRenderer.send('osr:input', s.id, ev)
  const at = (s: Surface, e: MouseEvent): { x: number; y: number } =>
    toPagePoint(e.clientX, e.clientY, c.getBoundingClientRect(), s.rect)
  const mouse = (type: string) => (e: MouseEvent) => {
    const s = surface()
    if (!s) return
    const p = at(s, e)
    if (type === 'mouseDown') {
      e.preventDefault() // the keyboard goes to the typing box (takeKeys), not to the canvas
      takeKeys(surface, e.clientX, e.clientY)
      ipcRenderer.send('osr:focus', s.id)
    }
    send(s, {
      type,
      ...p,
      button: BUTTON[e.button] ?? 'left',
      clickCount: type === 'mouseMove' ? 0 : e.detail || 1,
      modifiers: mods(e)
    })
  }
  c.addEventListener('mousedown', mouse('mouseDown'))
  c.addEventListener('mouseup', mouse('mouseUp'))
  c.addEventListener('mousemove', mouse('mouseMove'))
  c.addEventListener('mouseleave', mouse('mouseLeave'))
  c.addEventListener('mouseenter', mouse('mouseEnter'))
  // the page shows its own menu (main hears the page's context-menu event), never the window's
  c.addEventListener('contextmenu', (e) => e.preventDefault())
  c.addEventListener(
    'wheel',
    (e) => {
      const s = surface()
      if (!s) return
      e.preventDefault()
      e.stopPropagation()
      send(s, {
        type: 'mouseWheel',
        ...at(s, e),
        deltaX: wheelDelta(e.deltaX, e.deltaMode),
        deltaY: wheelDelta(e.deltaY, e.deltaMode),
        modifiers: mods(e)
      })
    },
    { passive: false }
  )
  // reached with Tab: the keyboard goes to the typing box all the same
  c.addEventListener('focus', () => {
    const r = c.getBoundingClientRect()
    takeKeys(surface, r.left + 8, r.top + 8)
  })
}

/**
 * The keyboard of the page clicked last goes through one hidden text box, so an input method (IME) can compose in it as
 * in any text field: plain keys are sent as they are, composed text is typed into the page once it is committed. The
 * box sits where the page was clicked, so the IME's candidate list opens there.
 */
let ime: HTMLTextAreaElement | null = null
let keysTo: (() => Surface | null) | null = null

function typingBox(): HTMLTextAreaElement {
  if (ime && ime.isConnected) return ime
  const t = document.createElement('textarea')
  t.setAttribute('aria-hidden', 'true')
  t.tabIndex = -1
  t.style.cssText =
    'position:absolute;left:0;top:0;width:2px;height:1.2em;opacity:0;pointer-events:none;resize:none;border:0;padding:0;font-size:16px'
  const to = (): Surface | null => keysTo?.() ?? null
  const send = (s: Surface, ev: Record<string, unknown>): void =>
    ipcRenderer.send('osr:input', s.id, ev)
  t.addEventListener('keydown', (e) => {
    const s = to()
    // an IME at work: its keys are its own until it commits (compositionend)
    if (!s || e.isComposing || e.key === 'Process' || e.keyCode === 229) return
    e.preventDefault()
    e.stopPropagation()
    send(s, { type: 'keyDown', keyCode: e.key, modifiers: mods(e) })
    // text: a printable key types its character (Ctrl/Alt chords are shortcuts, not text)
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey)
      send(s, { type: 'char', keyCode: e.key, modifiers: mods(e) })
  })
  t.addEventListener('keyup', (e) => {
    const s = to()
    if (!s || e.isComposing) return
    e.preventDefault()
    send(s, { type: 'keyUp', keyCode: e.key, modifiers: mods(e) })
  })
  t.addEventListener('compositionend', (e) => {
    const s = to()
    if (s) for (const ch of e.data ?? '') send(s, { type: 'char', keyCode: ch })
    t.value = ''
  })
  t.addEventListener('input', (e) => {
    if (!(e as InputEvent).isComposing) t.value = ''
  })
  ensureLayer().appendChild(t)
  ime = t
  return t
}

function takeKeys(get: () => Surface | null, x: number, y: number): void {
  keysTo = get
  const t = typingBox()
  t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  t.focus({ preventScroll: true })
}

function cursorFor(type: string): string {
  switch (type) {
    case 'hand':
      return 'pointer'
    case 'ibeam':
      return 'text'
    case 'wait':
      return 'wait'
    case 'progress':
      return 'progress'
    case 'crosshair':
      return 'crosshair'
    case 'move':
      return 'move'
    case 'not-allowed':
      return 'not-allowed'
    case 'grab':
      return 'grab'
    case 'grabbing':
      return 'grabbing'
    case 'ew-resize':
    case 'east-west-resize':
    case 'col-resize':
      return 'ew-resize'
    case 'ns-resize':
    case 'north-south-resize':
    case 'row-resize':
      return 'ns-resize'
    default:
      return 'default'
  }
}

export function startOffscreenPages(): void {
  ipcRenderer.on('osr:place', (_e, p: OsrPlace) => {
    if (!p || typeof p.id !== 'number') return
    let s = surfaces.get(p.id)
    if (p.gone) {
      if (s) {
        s.pending?.close()
        s.last?.close()
        s.own.remove()
        surfaces.delete(p.id)
      }
      return
    }
    if (!s) {
      const own = document.createElement('canvas')
      own.style.cssText =
        'position:absolute;left:0;top:0;pointer-events:auto;display:none;outline:none;transform-origin:0 0'
      ensureLayer().appendChild(own)
      s = {
        id: p.id,
        tab: null,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        visible: false,
        radius: 0,
        background: '#fff',
        own,
        into: own,
        ctx: null,
        pending: null,
        last: null
      }
      surfaces.set(p.id, s)
      wire(own, s)
    }
    if (p.tab !== undefined) s.tab = p.tab
    if (p.rect) s.rect = p.rect
    if (p.visible !== undefined) s.visible = p.visible
    if (p.radius !== undefined) s.radius = p.radius
    if (p.background) s.background = p.background
    retarget(s)
  })
  ipcRenderer.on('osr:cursor', (_e, id: number, type: string) => {
    const s = surfaces.get(id)
    if (s) s.into.style.cursor = cursorFor(type)
  })
  sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, meta) => {
    const id = (meta as { id?: number } | undefined)?.id
    const s = typeof id === 'number' ? surfaces.get(id) : undefined
    if (!s) {
      importedSharedTexture.release()
      return
    }
    const f = importedSharedTexture.getVideoFrame()
    importedSharedTexture.release()
    s.pending?.close() // only the newest frame is worth drawing
    s.pending = f
    schedule()
  })
}
