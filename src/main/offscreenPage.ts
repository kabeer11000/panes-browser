import {
  BrowserWindow,
  ipcMain,
  screen,
  sharedTexture,
  type Rectangle,
  type WebContents,
  type WebPreferences
} from 'electron'
import {
  ACTIVE_MS,
  frameAt,
  osrFrameRate,
  parseOsrDrop,
  parseOsrInput,
  parseOsrKey,
  toCdpKey,
  toCdpMouse,
  toElectronKeys,
  type OsrDrop,
  type OsrFrame,
  type OsrInput,
  type OsrKey,
  type OsrPlace
} from '@shared/offscreen'

/**
 * A tab's page drawn off screen (Chromium's offscreen rendering, GPU shared textures) instead of in a native view:
 * every frame goes, without a copy, to the window's own page, which draws it into a <canvas> (preload/osr.ts). The
 * page is then an ordinary element of the window: the board can scale, round, blur and move it with everything else,
 * where a native view could only be swapped for a picture.
 *
 * It answers to the part of WebContentsView that TabManager uses (bounds, visibility, corner radius, background), so
 * the tab code treats both alike; the few places that need a real native view (adding it to the window, picture in
 * picture, the saved copy shown over it) check `isOffscreen`.
 *
 * The page lives in a hidden offscreen window, which is what sizes it (a WebContentsView made offscreen keeps the size
 * of the window it is in). Drawing stops while it is hidden (`setVisible(false)` stops painting; nothing is drawn for
 * a page nobody sees), and it draws fewer frames while nobody is using it (osrFrameRate).
 */
export class OffscreenPage {
  readonly isOffscreen = true
  /** Input waiting its turn (registerOffscreenInput): each event after the one before it. */
  queue: Promise<void> = Promise.resolve()
  readonly webContents: WebContents
  /** The tab it shows (set once the tab has its id): the board finds its canvas by it. */
  tabId: number | null = null
  private host: BrowserWindow
  private bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
  private visible = false
  private radius = 0
  private background = '#ffffff'
  /** Frames on their way to the window's page: at most two, older ones dropped (the newest is the one worth drawing). */
  private inflight = 0
  private placeQueued = false
  /** The display's refresh rate, the most it draws; see osrFrameRate for when it draws less. */
  private displayHz = 60
  private lastInput = 0
  private media = false
  private fps = 0
  private idleTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly target: BrowserWindow,
    webPreferences: WebPreferences
  ) {
    const display = screen.getDisplayMatching(target.getBounds())
    const scale = display.scaleFactor
    this.host = new BrowserWindow({
      show: false,
      frame: false,
      width: 800,
      height: 600,
      useContentSize: true,
      skipTaskbar: true,
      webPreferences: {
        ...webPreferences,
        offscreen: { useSharedTexture: true, deviceScaleFactor: scale }
      }
    })
    this.webContents = this.host.webContents
    pages.set(this.webContents.id, this)
    this.webContents.stopPainting() // until it is shown
    // up to as many frames as the display shows (Chromium's offscreen default is 60, which would halve 120 Hz), and
    // fewer while nobody is using it (see osrFrameRate)
    this.displayHz = display.displayFrequency > 0 ? display.displayFrequency : 60
    this.pace()
    this.webContents.on('media-started-playing', () => {
      this.media = true
      this.pace()
    })
    this.webContents.on('media-paused', () => {
      this.media = false
      this.pace()
    })
    this.webContents.on('paint', (e) => this.frame(e.texture))
    // An offscreen page has no native popup for a <select> (it never opens). Chromium's customizable select draws its
    // list inside the page instead, so it opens and is drawn like the rest of the page.
    this.webContents.on('dom-ready', () => {
      if (!this.webContents.isDestroyed())
        void this.webContents.insertCSS(SELECT_IN_PAGE).catch(() => undefined)
    })
    this.webContents.on('cursor-changed', (_e, type, image, scale, _size, hotspot) => {
      if (this.target.isDestroyed()) return
      this.lastCursor = '' // the page set it: a frame's next answer is sent again
      // a page's own cursor picture goes with it, at its hot spot (in CSS px: the picture is at the screen's scale)
      const custom =
        type === 'custom' && image && !image.isEmpty()
          ? {
              url: image.toDataURL(),
              x: (hotspot?.x ?? 0) / (scale || 1),
              y: (hotspot?.y ?? 0) / (scale || 1)
            }
          : undefined
      this.target.webContents.send('osr:cursor', this.webContents.id, type, custom)
    })
    this.webContents.once('destroyed', () => {
      pages.delete(this.webContents.id)
      if (!this.target.isDestroyed())
        this.target.webContents.send('osr:place', { id: this.webContents.id, gone: true })
      if (!this.host.isDestroyed()) this.host.destroy()
    })
  }

  setBounds(r: Rectangle): void {
    const w = Math.max(1, Math.round(r.width))
    const h = Math.max(1, Math.round(r.height))
    const resized = w !== this.bounds.width || h !== this.bounds.height
    this.bounds = { x: Math.round(r.x), y: Math.round(r.y), width: w, height: h }
    if (resized && !this.host.isDestroyed()) {
      this.host.setContentSize(w, h)
      if (this.visible) this.webContents.invalidate()
    }
    this.place()
  }

  getBounds(): Rectangle {
    return { ...this.bounds }
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return
    this.visible = on
    if (!this.webContents.isDestroyed()) {
      if (on) {
        this.webContents.startPainting()
        this.webContents.invalidate() // a frame now, not at the page's next change
      } else this.webContents.stopPainting()
    }
    this.place()
  }

  getVisible(): boolean {
    return this.visible
  }

  setBorderRadius(px: number): void {
    if (px === this.radius) return
    this.radius = px
    this.place()
  }

  setBackgroundColor(color: string): void {
    if (color === this.background) return
    this.background = color
    this.place()
  }

  /** Frames a second; Chromium allows 1 to 240 with shared textures. */
  private setFrameRate(fps: number): void {
    const f = Math.max(1, Math.min(240, Math.round(fps)))
    if (f === this.fps || this.webContents.isDestroyed()) return
    this.fps = f
    this.webContents.setFrameRate(f)
  }

  /**
   * Files (or a link, or text) dropped on the page's canvas, replayed into the page through the DevTools protocol, as
   * an offscreen page gets no drags from the system: enter, over and drop at the point, with the files' paths.
   */
  async drop(d: OsrDrop): Promise<void> {
    const wc = this.webContents
    if (wc.isDestroyed() || !(await this.protocol())) return
    const items: Array<{ mimeType: string; data: string }> = []
    if (d.uri) items.push({ mimeType: 'text/uri-list', data: d.uri })
    if (d.text) items.push({ mimeType: 'text/plain', data: d.text })
    const data = { items, files: d.files, dragOperationsMask: 1 | 2 | 16 }
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const)
      await wc.debugger
        .sendCommand('Input.dispatchDragEvent', { type, x: d.x, y: d.y, data })
        .catch(() => undefined)
    this.touch()
  }

  /**
   * Frames of other sites in the page (each in its own process) by DevTools session. Chromium draws them in an offscreen
   * page but passes them no input, so mouse and wheel input over one is sent to it directly (input()).
   */
  private frames = new Map<string, OsrFrame & { frameId: string }>()
  /** The frame a press went to: the rest of that press (moves, the release) goes there too, wherever it is. */
  private pressFrame: OsrFrame | null = null
  private framesAt = 0
  private framesQueued = false
  private cdp: Promise<boolean> | null = null

  /** The page's DevTools connection (file drops, input to frames of other sites), opened once. */
  private protocol(): Promise<boolean> {
    if (this.cdp) return this.cdp
    this.cdp = (async () => {
      const wc = this.webContents
      if (wc.isDestroyed()) return false
      const d = wc.debugger
      try {
        if (!d.isAttached()) d.attach('1.3')
      } catch {
        this.cdp = null
        return false // DevTools open on it with a connection of its own: tried again next time
      }
      d.on('detach', () => {
        this.cdp = null
        this.frames.clear()
        this.pressFrame = null
      })
      d.on('message', (_e, method, params: Record<string, unknown>) => {
        if (method === 'Target.attachedToTarget') {
          const info = params.targetInfo as { type?: string; targetId?: string } | undefined
          const session = params.sessionId as string
          if (info?.type === 'iframe' && info.targetId) {
            this.frames.set(session, { session, frameId: info.targetId, rect: null })
            this.placeFramesSoon()
          }
        } else if (method === 'Target.detachedFromTarget') {
          const session = params.sessionId as string
          this.frames.delete(session)
          if (this.pressFrame?.session === session) this.pressFrame = null
        }
      })
      await d
        .sendCommand('Target.setAutoAttach', {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true
        })
        .catch(() => undefined)
      return true
    })()
    return this.cdp
  }

  /** Where each frame of another site is in the page now (its iframe's content box, CSS px). */
  private async placeFrames(): Promise<void> {
    this.framesAt = performance.now()
    const d = this.webContents.debugger
    await Promise.all(
      [...this.frames.values()].map(async (f) => {
        try {
          const owner = (await d.sendCommand('DOM.getFrameOwner', { frameId: f.frameId })) as {
            backendNodeId: number
          }
          const box = (await d.sendCommand('DOM.getBoxModel', {
            backendNodeId: owner.backendNodeId
          })) as { model: { content: number[] } }
          const q = box.model.content
          const xs = [q[0], q[2], q[4], q[6]]
          const ys = [q[1], q[3], q[5], q[7]]
          const x = Math.min(...xs)
          const y = Math.min(...ys)
          f.rect = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
        } catch {
          f.rect = null // not in the page's own document (inside another frame), or gone
        }
      })
    )
  }

  /** Placed again shortly (a scroll or a layout moved them), at most every quarter second. */
  private placeFramesSoon(): void {
    if (this.framesQueued) return
    this.framesQueued = true
    setTimeout(
      () => {
        this.framesQueued = false
        if (!this.webContents.isDestroyed() && this.frames.size > 0) void this.placeFrames()
      },
      Math.max(0, 250 - (performance.now() - this.framesAt))
    )
  }

  /**
   * Mouse, wheel or keys from the page's canvas. Over a frame of another site, mouse and wheel go to that frame through
   * the DevTools protocol, at the point in the frame; everything else is sent to the page as it is.
   */
  async input(ev: OsrInput): Promise<void> {
    const wc = this.webContents
    if (wc.isDestroyed()) return
    if (ev.type !== 'mouseMove' && ev.type !== 'mouseEnter' && ev.type !== 'mouseLeave')
      this.touch()
    if (!('x' in ev) || this.frames.size === 0) {
      wc.sendInputEvent(ev as Electron.MouseInputEvent | Electron.KeyboardInputEvent)
      // the first pointer input opens the connection, so frames of other sites are known from then on
      if ('x' in ev && !this.cdp) void this.protocol()
      return
    }
    // a press decides where the whole press goes; the frames are placed again for it first (the page may have moved)
    if (ev.type === 'mouseDown') {
      await this.placeFrames()
      this.pressFrame = frameAt(this.frames.values(), ev.x, ev.y)
    } else if (performance.now() - this.framesAt > 250) this.placeFramesSoon()
    const f = this.pressFrame ?? frameAt(this.frames.values(), ev.x, ev.y)
    if (ev.type === 'mouseUp') this.pressFrame = null
    if (ev.type === 'mouseWheel') this.placeFramesSoon() // it may scroll the page, and the frames with it
    if (!f?.rect) {
      wc.sendInputEvent(ev as Electron.MouseInputEvent | Electron.MouseWheelInputEvent)
      return
    }
    const fx = ev.x - f.rect.x
    const fy = ev.y - f.rect.y
    const cdp = toCdpMouse(ev, fx, fy)
    if (cdp)
      await wc.debugger
        .sendCommand('Input.dispatchMouseEvent', cdp, f.session)
        .catch(() => undefined)
    if (ev.type === 'mouseMove') this.frameCursor(f.session, fx, fy)
  }

  /**
   * The cursor over a frame of another site. Input sent to the frame directly does not change the cursor (Chromium
   * tracks it from its own routing), so the frame is asked what is under the pointer, at most every 24 ms.
   */
  private cursorAsk: { session: string; x: number; y: number } | null = null
  private lastCursor = ''
  private frameCursor(session: string, x: number, y: number): void {
    const pending = this.cursorAsk !== null
    this.cursorAsk = { session, x, y }
    if (pending) return
    setTimeout(() => {
      const ask = this.cursorAsk
      this.cursorAsk = null
      if (!ask || this.webContents.isDestroyed()) return
      void this.webContents.debugger
        .sendCommand(
          'Runtime.evaluate',
          { expression: cursorScript(ask.x, ask.y), returnByValue: true, silent: true },
          ask.session
        )
        .then((r: { result?: { value?: unknown } }) => {
          const c = typeof r?.result?.value === 'string' ? r.result.value : 'default'
          if (c === this.lastCursor || this.target.isDestroyed()) return
          this.lastCursor = c
          this.target.webContents.send('osr:cursor', this.webContents.id, c)
        })
        .catch(() => undefined)
    }, 24)
  }

  /**
   * A key, through the DevTools protocol: it takes the DOM's own key names and codes (arrows, Enter, Tab, shortcuts all
   * as on any page) and reaches whichever frame has the focus, another site's too. sendInputEvent only when the
   * protocol is not there (DevTools open on the page with a connection of its own).
   */
  async key(k: OsrKey): Promise<void> {
    const wc = this.webContents
    if (wc.isDestroyed()) return
    this.touch()
    if (await this.protocol()) {
      const ok = await wc.debugger
        .sendCommand('Input.dispatchKeyEvent', toCdpKey(k))
        .then(() => true)
        .catch(() => false)
      if (ok) return
    }
    for (const ev of toElectronKeys(k)) wc.sendInputEvent(ev as Electron.KeyboardInputEvent)
  }

  /** Text an input method made, typed into the focused field as it is. */
  async text(text: string): Promise<void> {
    const wc = this.webContents
    if (wc.isDestroyed()) return
    this.touch()
    if (await this.protocol()) {
      const ok = await wc.debugger
        .sendCommand('Input.insertText', { text })
        .then(() => true)
        .catch(() => false)
      if (ok) return
    }
    for (const ch of text) wc.sendInputEvent({ type: 'char', keyCode: ch })
  }

  /** Someone is using the page (input on its canvas): full rate now, back to the idle rate once they stop. */
  touch(): void {
    this.lastInput = performance.now()
    this.pace()
  }

  private pace(): void {
    const since = performance.now() - this.lastInput
    this.setFrameRate(
      osrFrameRate({ displayHz: this.displayHz, sinceInputMs: since, media: this.media })
    )
    clearTimeout(this.idleTimer)
    if (since < ACTIVE_MS) this.idleTimer = setTimeout(() => this.pace(), ACTIVE_MS - since + 10)
  }

  /** Where it is, sent once per task however many changes it took (a layout pass sets bounds and visibility both). */
  private place(): void {
    if (this.placeQueued) return
    this.placeQueued = true
    queueMicrotask(() => {
      this.placeQueued = false
      if (this.target.isDestroyed() || this.webContents.isDestroyed()) return
      const msg: OsrPlace = {
        id: this.webContents.id,
        tab: this.tabId,
        rect: this.bounds,
        visible: this.visible,
        radius: this.radius,
        background: this.background
      }
      this.target.webContents.send('osr:place', msg)
    })
  }

  private frame(texture: Electron.OffscreenSharedTexture | undefined): void {
    if (!texture) return
    if (!this.visible || this.inflight > 1 || this.target.isDestroyed()) {
      texture.release()
      return
    }
    let imported: Electron.SharedTextureImported
    try {
      imported = sharedTexture.importSharedTexture({
        textureInfo: texture.textureInfo,
        allReferencesReleased: () => texture.release()
      })
    } catch {
      texture.release()
      return
    }
    this.inflight++
    sharedTexture
      .sendSharedTexture(
        { frame: this.target.webContents.mainFrame, importedSharedTexture: imported },
        { id: this.webContents.id }
      )
      .catch(() => undefined)
      .finally(() => {
        imported.release()
        this.inflight--
      })
  }
}

const pages = new Map<number, OffscreenPage>()

/**
 * The cursor the element at a point wants (run in a frame, leaving nothing behind): its CSS cursor, or for `auto` what
 * Chromium would show, a hand on a link, an I-beam on text and in text fields, the arrow elsewhere.
 */
function cursorScript(x: number, y: number): string {
  return `(() => {
    const el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)})
    if (!el) return 'default'
    const c = getComputedStyle(el).cursor
    if (c && c !== 'auto') return c.startsWith('url(') ? 'default' : c
    if (el.closest('a[href], area[href]')) return 'pointer'
    if (el.closest('textarea, input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), [contenteditable=""], [contenteditable=true]')) return 'text'
    const p = document.caretPositionFromPoint ? document.caretPositionFromPoint(${Math.round(x)}, ${Math.round(y)}) : null
    return p && p.offsetNode && p.offsetNode.nodeType === 3 && p.offsetNode.textContent.trim() ? 'text' : 'default'
  })()`
}

/** See the dom-ready handler: selects open inside the page. */
const SELECT_IN_PAGE = 'select, ::picker(select) { appearance: base-select !important; }'

/** Whether this view is drawn off screen (OffscreenPage) rather than being a native view. */
export const isOffscreen = (v: unknown): v is OffscreenPage =>
  !!v && (v as { isOffscreen?: unknown }).isOffscreen === true

/**
 * Input for offscreen pages, from the window's page that draws them (preload/osr.ts): mouse, wheel and keys, already
 * in the page's own coordinates. Only from `win`'s own page, and only to a page that is drawn there.
 */
export function registerOffscreenInput(win: BrowserWindow): void {
  ipcMain.on('osr:input', (e, id: unknown, raw: unknown) => {
    if (e.sender !== win.webContents || typeof id !== 'number') return
    const page = pages.get(id)
    const ev = parseOsrInput(raw)
    if (!page || !ev || page.webContents.isDestroyed()) return
    // in order: a press must reach its frame before the moves and the release that follow it
    page.queue = page.queue.then(() => page.input(ev)).catch(() => undefined)
  })
  ipcMain.on('osr:drop', (e, id: unknown, raw: unknown) => {
    if (e.sender !== win.webContents || typeof id !== 'number') return
    const page = pages.get(id)
    const d = parseOsrDrop(raw)
    if (page && d) void page.drop(d)
  })
  ipcMain.on('osr:key', (e, id: unknown, raw: unknown) => {
    if (e.sender !== win.webContents || typeof id !== 'number') return
    const page = pages.get(id)
    const k = parseOsrKey(raw)
    if (!page || !k || page.webContents.isDestroyed()) return
    page.queue = page.queue.then(() => page.key(k)).catch(() => undefined)
  })
  ipcMain.on('osr:text', (e, id: unknown, text: unknown) => {
    if (e.sender !== win.webContents || typeof id !== 'number') return
    const page = pages.get(id)
    if (!page || typeof text !== 'string' || text.length === 0 || text.length > 1000) return
    page.queue = page.queue.then(() => page.text(text)).catch(() => undefined)
  })
  ipcMain.on('osr:focus', (e, id: unknown) => {
    if (e.sender !== win.webContents || typeof id !== 'number') return
    const page = pages.get(id)
    if (page && !page.webContents.isDestroyed()) page.webContents.focus()
  })
}
