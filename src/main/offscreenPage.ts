import {
  BrowserWindow,
  ipcMain,
  screen,
  sharedTexture,
  type Rectangle,
  type WebContents,
  type WebPreferences
} from 'electron'
import { ACTIVE_MS, osrFrameRate, parseOsrInput, type OsrPlace } from '@shared/offscreen'

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
    this.webContents.on('cursor-changed', (_e, type) => {
      if (!this.target.isDestroyed())
        this.target.webContents.send('osr:cursor', this.webContents.id, type)
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
    if (ev.type !== 'mouseMove' && ev.type !== 'mouseEnter' && ev.type !== 'mouseLeave')
      page.touch()
    page.webContents.sendInputEvent(
      ev as Electron.MouseInputEvent | Electron.MouseWheelInputEvent | Electron.KeyboardInputEvent
    )
  })
  ipcMain.on('osr:focus', (e, id: unknown) => {
    if (e.sender !== win.webContents || typeof id !== 'number') return
    const page = pages.get(id)
    if (page && !page.webContents.isDestroyed()) page.webContents.focus()
  })
}
