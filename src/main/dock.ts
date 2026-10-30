import { is } from '@electron-toolkit/utils'
import {
  ipcMain,
  screen,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  WebContentsView,
  type WebContents
} from 'electron'
import { join } from 'path'
import type { DockMode, DockOverlayState, DownloadAction } from '../shared/types'
import { paintView } from './chromeTheme'
import type { DownloadManager } from './downloads'

// The bin's view is only as big as the bin and a little room round it, and stops short of the window's right edge, so the
// page's scrollbar and anything at its extreme right can still be reached.
const WIDTH = 100
const HEIGHT = 96
const INSET = 8 // the window's right edge left free
const SLIVER = 12 // how much of it shows, at the window's bottom edge, while the bin is tucked away: also the strip of page it covers
const OVERLAY_HIDE_MS = 260 // the fan's exit animation, before its view goes
// The pointer has to rest in a small slot at the very corner to bring the bin out, so passing through (to the page's
// scrollbar, say) does not. Once out it stays until the pointer is well away.
const CORNER_X = 64
const CORNER_Y = 28
const REACH_X = 130
const REACH_Y = 120
const DWELL_MS = 320
const LEAVE_MS = 350
const ACTIONS = ['open', 'show', 'cancel', 'pause', 'resume', 'remove']

/**
 * The downloads bin: two transparent views above the page. The bin is a small view at the window's bottom-right corner;
 * tucked away it is only a sliver of its top at the very edge, out it is the whole bin. It is only ever moved, never
 * resized: a resized view shows its old frame at its new top-left until the page has drawn the new one. The fan (and
 * the file flying to the bin) is a second view that is always window-sized and is only shown and hidden, so it never
 * resizes either. Page views are native and paint over the window's own UI, so these have to be views of their own.
 */
class Dock {
  private view: WebContentsView | null = null
  private overlay: WebContentsView | null = null
  private mode: DockMode = 'peek'
  private loaded = new WeakSet<WebContentsView>()
  private hidden = false
  private wanted = false // the fan view is wanted: a fan is open or a file is flying
  private slideTimer: ReturnType<typeof setTimeout> | undefined
  private overlayTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private win: BrowserWindow) {
    win.on('resize', () => this.place())
    win.on('enter-full-screen', () => this.show())
    win.on('leave-full-screen', () => this.show())
  }

  /** The bin's page. */
  get contents(): WebContents | null {
    return this.view?.webContents ?? null
  }

  /** Whether a page is one of the two this owns. */
  owns(wc: WebContents): boolean {
    return wc === this.view?.webContents || wc === this.overlay?.webContents
  }

  start(): void {
    this.view = this.make('')
    this.overlay = this.make('#overlay')
    this.overlay.setVisible(false)
    this.place()
    this.raise()
  }

  private make(hash: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: { sandbox: true, preload: join(__dirname, '../preload/dock.js') }
    })
    view.setBackgroundColor('#00000000')
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl) void view.webContents.loadURL(`${devUrl}/dock.html${hash}`)
    else
      void view.webContents.loadFile(join(__dirname, '../renderer/dock.html'), {
        hash: hash.slice(1)
      })
    view.webContents.once('did-finish-load', () => {
      this.loaded.add(view)
      paintView(view.webContents)
    })
    return view
  }

  /** Off the window altogether (the pane view is open over that edge), or back to its place. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return
    this.hidden = hidden
    clearTimeout(this.slideTimer)
    if (this.mode !== 'peek') return this.show() // out or fanned: it just goes, or comes back as it was
    if (hidden) {
      // it sinks off the edge, then the view goes
      this.send('dock:slide', 'sink')
      this.slideTimer = setTimeout(() => this.show(), 200)
    } else {
      // a beat after the pane view has gone it rises again, from below the edge
      this.send('dock:slide', 'tuck')
      this.slideTimer = setTimeout(() => {
        this.show()
        this.send('dock:slide', 'rise')
      }, 240)
    }
  }

  get isHidden(): boolean {
    return this.hidden
  }

  private show(): void {
    const away = this.hidden || this.win.isFullScreen()
    this.view?.setVisible(!away)
    this.overlay?.setVisible(!away && this.wanted)
  }

  /** Back on top of the page views, which are added later than this view and would otherwise cover it. */
  raise(): void {
    if (!this.view || !this.overlay || this.win.isDestroyed()) return
    this.win.contentView.addChildView(this.view)
    this.win.contentView.addChildView(this.overlay) // the fan covers the bin, so it goes on top of it
  }

  setMode(mode: DockMode): void {
    if (mode === this.mode) return
    this.mode = mode
    if (mode !== 'peek' && this.view && this.loaded.has(this.view)) paintView(this.view.webContents)
    this.place()
    this.raise()
  }

  /** The fan view reports what it is doing: it is shown while it is needed, and a moment after, for its exit. */
  setOverlay(state: DockOverlayState): void {
    clearTimeout(this.overlayTimer)
    this.send('dock:overlay', state)
    if (state.active) {
      this.wanted = true
      this.show()
      if (state.open && this.overlay && !this.overlay.webContents.isDestroyed()) {
        this.overlay.webContents.focus() // so Escape closes the fan
      }
    } else {
      this.overlayTimer = setTimeout(() => {
        this.wanted = false
        this.show()
      }, OVERLAY_HIDE_MS)
    }
  }

  /** To the bin's page. */
  send(channel: string, ...args: unknown[]): void {
    this.sendTo(this.view, channel, ...args)
  }

  private sendTo(view: WebContentsView | null, channel: string, ...args: unknown[]): void {
    if (view && this.loaded.has(view) && !view.webContents.isDestroyed()) {
      view.webContents.send(channel, ...args)
    }
  }

  sendOverlay(channel: string, ...args: unknown[]): void {
    this.sendTo(this.overlay, channel, ...args)
  }

  sendBoth(channel: string, ...args: unknown[]): void {
    this.sendTo(this.view, channel, ...args)
    this.sendTo(this.overlay, channel, ...args)
  }

  private place(): void {
    if (!this.view || !this.overlay || this.win.isDestroyed()) return
    const [w, h] = this.win.getContentSize()
    // tucked away, the bin's view sits mostly below the window's edge and only its top shows
    const y = this.mode === 'peek' ? h - SLIVER : h - HEIGHT
    this.view.setBounds({ x: w - INSET - WIDTH, y, width: WIDTH, height: HEIGHT })
    this.overlay.setBounds({ x: 0, y: 0, width: w, height: h })
  }
}

/**
 * The bin: shows the downloads (with a picture of each), takes in new ones, and comes out when the pointer rests in
 * the corner. The main process watches the real cursor, since the page cannot see it over a native page view.
 */
export function registerDock(
  win: BrowserWindow,
  downloads: DownloadManager,
  openDownloadsPage: () => void
): { raise: () => void; setHidden: (hidden: boolean) => void } {
  const dock = new Dock(win)
  dock.start()
  const fromDock = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => dock.owns(e.sender)
  const fromBin = (e: IpcMainEvent): boolean => e.sender === dock.contents
  downloads.onChange(() => dock.sendBoth('downloads:state', downloads.view()))
  downloads.onStart((info) => {
    if (win.isDestroyed() || dock.isHidden) return // hidden pages run no animation frames, so a flight would never land
    const p = screen.getCursorScreenPoint()
    const b = win.getContentBounds()
    const x = p.x - b.x
    const y = p.y - b.y
    const inside = x >= 0 && x <= b.width && y >= 0 && y <= b.height
    dock.sendOverlay('downloads:start', { download: info, at: inside ? { x, y } : null })
  })
  ipcMain.handle('downloads:list', (e) => (fromDock(e) ? downloads.view() : []))
  ipcMain.on('downloads:act', (e, id: unknown, action: unknown) => {
    if (fromDock(e) && typeof id === 'number' && ACTIONS.includes(action as string)) {
      downloads.act(id, action as DownloadAction)
    }
  })
  ipcMain.on('dock:mode', (e, mode: unknown) => {
    if (fromBin(e) && (mode === 'peek' || mode === 'out')) dock.setMode(mode)
  })
  ipcMain.on('dock:toggle', (e) => {
    if (fromBin(e)) dock.sendOverlay('dock:toggle')
  })
  ipcMain.on('dock:report', (e, state: unknown) => {
    const s = state as Partial<DockOverlayState> | null
    if (
      dock.owns(e.sender) &&
      !fromBin(e) &&
      typeof s?.open === 'boolean' &&
      typeof s.active === 'boolean'
    ) {
      dock.setOverlay({ open: s.open, active: s.active })
    }
  })
  ipcMain.on('dock:landed', (e) => {
    if (dock.owns(e.sender) && !fromBin(e)) dock.send('dock:landed')
  })
  ipcMain.on('dock:open-downloads', (e) => {
    if (fromDock(e)) openDownloadsPage()
  })

  let near = false
  let since = 0
  const timer = setInterval(() => {
    if (win.isDestroyed() || !win.isFocused() || win.isFullScreen()) {
      if (near) {
        near = false
        dock.send('dock:corner', false)
      }
      since = 0
      return
    }
    const p = screen.getCursorScreenPoint()
    const b = win.getContentBounds()
    const x = p.x - b.x
    const y = p.y - b.y
    const inside = x >= 0 && x <= b.width && y >= 0 && y <= b.height
    const wanted =
      inside &&
      x >= b.width - (near ? REACH_X : CORNER_X) &&
      y >= b.height - (near ? REACH_Y : CORNER_Y)
    if (wanted !== near) {
      since ||= Date.now()
      if (Date.now() - since >= (wanted ? DWELL_MS : LEAVE_MS)) {
        near = wanted
        since = 0
        dock.send('dock:corner', near)
      }
    } else since = 0
  }, 50)
  win.on('closed', () => clearInterval(timer))
  return { raise: () => dock.raise(), setHidden: (hidden) => dock.setHidden(hidden) }
}
