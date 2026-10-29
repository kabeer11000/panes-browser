import { is } from '@electron-toolkit/utils'
import { ipcMain, screen, type BrowserWindow, WebContentsView, type WebContents } from 'electron'
import { join } from 'path'
import type { DockMode, DownloadAction } from '../shared/types'
import { paintView } from './chromeTheme'
import type { DownloadManager } from './downloads'

// The view is only as big as the bin and a little room round it, and stops short of the window's right edge, so the
// page's scrollbar and anything at its extreme right can still be reached.
const WIDTH = 100
const HEIGHT = 96
const INSET = 8 // the window's right edge left free
const SLIVER = 12 // how much of it shows, at the window's bottom edge, while the bin is tucked away: also the strip of page it covers
const CORNER_PX = 48 // the pointer this near the corner brings the bin out
const REACH_PX = 150 // and keeps it out until the pointer is this far away
const DWELL_MS = 110
const LEAVE_MS = 450
const ACTIONS = ['open', 'show', 'cancel', 'pause', 'resume', 'remove']

/**
 * The downloads bin: a small transparent view at the window's bottom-right corner, above the page. Tucked away it
 * is only a sliver of the bin's top at the very edge; out, it is the whole bin; while a fan is open or a file is
 * flying to it, it covers the whole window (the bin itself stays where it is). Page views are native and paint
 * over the window's own UI, so this one has to be a view of its own.
 */
class Dock {
  private view: WebContentsView | null = null
  private mode: DockMode = 'peek'
  private loaded = false
  private hidden = false
  private slideTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private win: BrowserWindow) {
    win.on('resize', () => this.place())
    win.on('enter-full-screen', () => this.show())
    win.on('leave-full-screen', () => this.show())
  }

  get contents(): WebContents | null {
    return this.view?.webContents ?? null
  }

  start(): void {
    const view = new WebContentsView({
      webPreferences: { sandbox: true, preload: join(__dirname, '../preload/dock.js') }
    })
    view.setBackgroundColor('#00000000')
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl) void view.webContents.loadURL(`${devUrl}/dock.html`)
    else void view.webContents.loadFile(join(__dirname, '../renderer/dock.html'))
    view.webContents.once('did-finish-load', () => {
      this.loaded = true
      paintView(view.webContents)
    })
    this.view = view
    this.place()
    this.raise()
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

  private show(): void {
    this.view?.setVisible(!this.hidden && !this.win.isFullScreen())
  }

  /** Back on top of the page views, which are added later than this view and would otherwise cover it. */
  raise(): void {
    if (!this.view || this.win.isDestroyed()) return
    this.win.contentView.addChildView(this.view)
  }

  setMode(mode: DockMode): void {
    if (mode === this.mode) return
    this.mode = mode
    if (mode !== 'peek' && this.view && this.loaded) paintView(this.view.webContents)
    this.place()
    this.raise()
  }

  send(channel: string, ...args: unknown[]): void {
    if (this.view && this.loaded && !this.view.webContents.isDestroyed()) {
      this.view.webContents.send(channel, ...args)
    }
  }

  private place(): void {
    if (!this.view || this.win.isDestroyed()) return
    const [w, h] = this.win.getContentSize()
    if (this.mode === 'full') this.view.setBounds({ x: 0, y: 0, width: w, height: h })
    else {
      // tucked away, the view sits mostly below the window's edge and only its top shows
      const y = this.mode === 'peek' ? h - SLIVER : h - HEIGHT
      this.view.setBounds({ x: w - INSET - WIDTH, y, width: WIDTH, height: HEIGHT })
    }
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
  downloads.onChange(() => dock.send('downloads:state', downloads.view()))
  downloads.onStart((info) => {
    if (win.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    const b = win.getContentBounds()
    const x = p.x - b.x
    const y = p.y - b.y
    const inside = x >= 0 && x <= b.width && y >= 0 && y <= b.height
    dock.send('downloads:start', { download: info, at: inside ? { x, y } : null })
  })
  ipcMain.handle('downloads:list', (e) => (e.sender === dock.contents ? downloads.view() : []))
  ipcMain.on('downloads:act', (e, id: unknown, action: unknown) => {
    if (
      e.sender === dock.contents &&
      typeof id === 'number' &&
      ACTIONS.includes(action as string)
    ) {
      downloads.act(id, action as DownloadAction)
    }
  })
  ipcMain.on('dock:mode', (e, mode: unknown) => {
    if (e.sender === dock.contents && (mode === 'peek' || mode === 'out' || mode === 'full')) {
      dock.setMode(mode)
    }
  })
  ipcMain.on('dock:open-downloads', (e) => {
    if (e.sender === dock.contents) openDownloadsPage()
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
    const reach = near ? REACH_PX : CORNER_PX
    const wanted = inside && x >= b.width - reach && y >= b.height - reach
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
