import { ipcRenderer, sharedTexture, webUtils } from 'electron'
import {
  cssCursor,
  heldButtons,
  nextClickCount,
  TAP_SLOP_PX,
  toPagePoint,
  wheelDelta,
  type OsrModifier,
  type OsrPlace
} from '@shared/offscreen'

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
    // a live card's canvas only shows the page (data-osr-passive): clicks on it are the board's
    if (board && !board.hasAttribute('data-osr-passive')) wire(board, s)
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
    // the board shows its canvas once something is drawn in it (a live card fades in on its first frame)
    if (c !== s.own && !c.hasAttribute('data-osr-drawn')) c.setAttribute('data-osr-drawn', '')
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
  // the page handles fingers itself (taps, its own scrolling), and nothing on it is selected as the window's text
  c.style.touchAction = 'none'
  c.style.userSelect = 'none'
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
  /**
   * The pointer, as the page's mouse. While a button is held, its moves and its release are followed on the whole
   * window, so the release reaches the page wherever it happens (a release outside the canvas was lost, and the page
   * went on as if the button were held, every move after it a text selection; pointer capture alone did not always
   * hold). Moves carry the buttons really held, nothing else.
   * A finger: a tap is a click, a drag scrolls the page (as a wheel would), not a selection.
   */
  let lastPress: { at: number; x: number; y: number; count: number; button: number } | null = null
  let touch: {
    id: number
    x: number
    y: number
    lastX: number
    lastY: number
    moved: boolean
  } | null = null
  const press = (s: Surface, e: PointerEvent | MouseEvent, type: 'mouseDown' | 'mouseUp'): void => {
    const button = BUTTON[e.button] ?? 'left'
    let count = lastPress?.count ?? 1
    if (type === 'mouseDown') {
      count = nextClickCount(lastPress, {
        at: e.timeStamp,
        x: e.clientX,
        y: e.clientY,
        button: e.button
      })
      lastPress = { at: e.timeStamp, x: e.clientX, y: e.clientY, count, button: e.button }
    }
    send(s, {
      type,
      ...at(s, e),
      button,
      clickCount: count,
      modifiers: [...mods(e), ...heldButtons(e.buttons)]
    })
  }
  /** The mouse button held down on this page (its pointer id), followed on the whole window until it is let go. */
  let held: number | null = null
  const moveTo = (s: Surface, e: PointerEvent): void =>
    send(s, {
      type: 'mouseMove',
      ...at(s, e),
      ...(e.buttons ? { button: BUTTON[e.button] ?? 'left' } : {}),
      modifiers: [...mods(e), ...heldButtons(e.buttons)]
    })
  const heldMove = (e: PointerEvent): void => {
    if (e.pointerId !== held) return
    const s = surface()
    if (s) moveTo(s, e)
  }
  const heldUp = (e: PointerEvent): void => {
    if (e.pointerId !== held) return
    // a release with another button still down is not the end of the press
    if (e.type === 'pointerup' && e.buttons !== 0) {
      const s = surface()
      if (s) press(s, e, 'mouseUp')
      return
    }
    held = null
    window.removeEventListener('pointermove', heldMove, true)
    window.removeEventListener('pointerup', heldUp, true)
    window.removeEventListener('pointercancel', heldUp, true)
    const s = surface()
    if (!s) return
    if (e.type === 'pointercancel') {
      // the system took the pointer: the page must not think the button is still held
      send(s, { type: 'mouseUp', ...at(s, e), button: 'left', clickCount: 1, modifiers: [] })
    } else press(s, e, 'mouseUp')
    // let go outside the canvas: the pointer has left the page now
    const r = c.getBoundingClientRect()
    const inside =
      e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom
    if (!inside) send(s, { type: 'mouseLeave', ...at(s, e), modifiers: [] })
  }
  const focusPage = (s: Surface, e: PointerEvent): void => {
    takeKeys(surface, e.clientX, e.clientY)
    ipcRenderer.send('osr:focus', s.id)
  }
  c.addEventListener('pointerdown', (e) => {
    const s = surface()
    if (!s) return
    // the page's own: no selection in the window, no gesture of the board under it, the keys to the typing box
    e.preventDefault()
    e.stopPropagation()
    try {
      c.setPointerCapture(e.pointerId)
    } catch {
      // a pointer already gone
    }
    focusPage(s, e)
    if (e.pointerType === 'touch') {
      if (!e.isPrimary) return
      touch = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false
      }
      return
    }
    press(s, e, 'mouseDown')
    if (held === null) {
      held = e.pointerId
      window.addEventListener('pointermove', heldMove, true)
      window.addEventListener('pointerup', heldUp, true)
      window.addEventListener('pointercancel', heldUp, true)
    }
  })
  c.addEventListener('pointermove', (e) => {
    const s = surface()
    if (!s) return
    if (e.pointerType === 'touch') {
      const t = touch
      if (!t || t.id !== e.pointerId) return
      if (!t.moved && Math.hypot(e.clientX - t.x, e.clientY - t.y) < TAP_SLOP_PX) return
      t.moved = true
      // the page under the finger follows it: a drag down shows what is above
      send(s, {
        type: 'mouseWheel',
        ...at(s, e),
        deltaX: e.clientX - t.lastX,
        deltaY: e.clientY - t.lastY,
        modifiers: []
      })
      t.lastX = e.clientX
      t.lastY = e.clientY
      return
    }
    // while a button is held, the window's listener sends the moves (heldMove)
    if (held === null) moveTo(s, e)
  })
  const up = (e: PointerEvent): void => {
    const s = surface()
    if (!s) return
    if (e.pointerType === 'touch') {
      const t = touch
      if (!t || t.id !== e.pointerId) return
      touch = null
      if (t.moved || e.type === 'pointercancel') return
      // a tap: a click where the finger was
      press(s, e, 'mouseDown')
      press(s, e, 'mouseUp')
      return
    }
    // a mouse or pen: its release is heard on the window (heldUp)
  }
  c.addEventListener('pointerup', up)
  c.addEventListener('pointercancel', up)
  // the window's own text selection and drag never start from the page
  c.addEventListener('mousedown', (e) => e.preventDefault())
  c.addEventListener('selectstart', (e) => e.preventDefault())
  c.addEventListener('dragstart', (e) => e.preventDefault())
  const edge = (type: 'mouseEnter' | 'mouseLeave') => (e: PointerEvent) => {
    const s = surface()
    if (!s || e.pointerType === 'touch') return
    // a held button leaving the canvas is still the page's (a drag out of it): no leave until it is let go
    if (type === 'mouseLeave' && held === e.pointerId) return
    send(s, { type, ...at(s, e), modifiers: [...mods(e), ...heldButtons(e.buttons)] })
  }
  c.addEventListener('pointerenter', edge('mouseEnter'))
  c.addEventListener('pointerleave', edge('mouseLeave'))
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
  // Files, links or text dragged from elsewhere: the page gets no drags from the system, so the drop is replayed into
  // it at the point (main, OffscreenPage.drop), files by their paths
  c.addEventListener('dragover', (e) => {
    if (!surface()) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  })
  c.addEventListener('drop', (e) => {
    const s = surface()
    if (!s || !e.dataTransfer) return
    e.preventDefault()
    e.stopPropagation()
    const files: string[] = []
    for (const f of e.dataTransfer.files) {
      const path = webUtils.getPathForFile(f)
      if (path) files.push(path)
    }
    ipcRenderer.send('osr:drop', s.id, {
      ...at(s, e),
      files,
      text: e.dataTransfer.getData('text/plain') || null,
      uri: e.dataTransfer.getData('text/uri-list') || null
    })
  })
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
  t.addEventListener('keydown', (e) => {
    const s = to()
    // an IME at work: its keys are its own until it commits (compositionend)
    if (!s || e.isComposing || e.key === 'Process' || e.keyCode === 229) return
    e.preventDefault()
    e.stopPropagation()
    sendKey(s, 'down', e)
  })
  t.addEventListener('keyup', (e) => {
    const s = to()
    if (!s || e.isComposing) return
    e.preventDefault()
    sendKey(s, 'up', e)
  })
  t.addEventListener('compositionend', (e) => {
    const s = to()
    // what the IME made, typed into the page as text (the page's own composition is not shown meanwhile)
    if (s && e.data) ipcRenderer.send('osr:text', s.id, e.data)
    t.value = ''
  })
  t.addEventListener('input', (e) => {
    if (!(e as InputEvent).isComposing) t.value = ''
  })
  ensureLayer().appendChild(t)
  ime = t
  return t
}

/** A key as the DOM gave it (its name, its code, the virtual key code): main passes it on to the page whole. */
function sendKey(s: Surface, type: 'down' | 'up', e: KeyboardEvent): void {
  ipcRenderer.send('osr:key', s.id, {
    type,
    key: e.key,
    code: e.code,
    keyCode: e.keyCode,
    location: e.location,
    repeat: e.repeat,
    modifiers: mods(e).filter((m) => m !== 'isAutoRepeat')
  })
}

function takeKeys(get: () => Surface | null, x: number, y: number): void {
  keysTo = get
  const t = typingBox()
  t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  t.focus({ preventScroll: true })
}

/** Whether a tab's page is drawn off screen here (its live card then draws its frames instead of capturing it). */
export function isOffscreenTab(tab: number): boolean {
  for (const s of surfaces.values()) if (s.tab === tab) return true
  return false
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
  // the page's cursor over its canvas: CSS's own name, or the page's own picture (a custom cursor) at its hot spot
  ipcRenderer.on(
    'osr:cursor',
    (_e, id: number, type: string, custom?: { url: string; x: number; y: number }) => {
      const s = surfaces.get(id)
      if (!s) return
      s.into.style.cursor =
        type === 'custom' && custom
          ? `url("${custom.url}") ${Math.round(custom.x)} ${Math.round(custom.y)}, default`
          : cssCursor(type)
    }
  )
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
