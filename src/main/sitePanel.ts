import { is } from '@electron-toolkit/utils'
import {
  ipcMain,
  WebContentsView,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'path'
import type { Rect } from '../shared/types'
import type { SiteSettings } from './sites'
import { paintView } from './chromeTheme'

const WIDTH = 352
const PAD = 36 // room around the card for its shadow, so the view never clips it
const GAP = 4 // between the address bar's button and the card
const PUSH_DELAY_MS = 80

interface Deps {
  win: BrowserWindow
  sites: SiteSettings
  /** Let the user pick an element on the page; calls back with its selector, or null if cancelled. */
  pickElement: (done: (selector: string | null) => void) => void
}

/**
 * The site panel (permissions, connection, ad blocker, data, zoom, sound, boost) in a transparent view of its
 * own above the page. The page stays live behind it, so a boost can be watched as it is shaped, and the panel
 * is kept up to date while it is open (see refresh). It closes when anything else takes focus.
 */
export class SitePanel {
  private view: WebContentsView | null = null
  private anchor: Rect | null = null
  private height = 420
  private picking = false
  private blurredAt = 0
  private pushTimer: NodeJS.Timeout | null = null

  constructor(private d: Deps) {
    const fromPanel = (e: IpcMainEvent | IpcMainInvokeEvent): boolean =>
      !!this.view && e.sender === this.view.webContents
    ipcMain.handle('panel:info', (e) => (fromPanel(e) ? this.d.sites.info() : null))
    ipcMain.handle('panel:update', (e, patch: unknown) =>
      fromPanel(e) ? this.d.sites.update(patch) : null
    )
    ipcMain.on('panel:resize', (e, h: unknown) => {
      if (!fromPanel(e) || typeof h !== 'number' || !Number.isFinite(h) || h < 0) return
      this.height = Math.ceil(Math.min(h, 800))
      this.place()
    })
    ipcMain.on('panel:close', (e) => fromPanel(e) && this.hide())
    ipcMain.on('panel:pick', (e) => {
      if (!fromPanel(e)) return
      this.picking = true // the page takes focus to receive the click; that is not "clicked away"
      this.d.pickElement((selector) => {
        this.picking = false
        // The panel stays where it was (the boost editor); fresh state brings the new item into its list.
        if (selector) void this.d.sites.update({ zapAdd: selector }).then(() => this.refresh())
        this.view?.webContents.focus()
      })
    })
    d.win.on('resize', () => this.hide())
  }

  get visible(): boolean {
    return !!this.view?.getVisible()
  }

  /**
   * Something the open panel shows may have changed (the tab navigated or loaded, an answer was given, a setting
   * changed elsewhere): send it fresh state. Tabs report changes in bursts, so this waits a moment and sends once.
   */
  refresh(): void {
    if (!this.visible || this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      if (!this.visible) return
      void this.d.sites.info().then((info) => {
        const wc = this.view?.webContents
        if (wc && !wc.isDestroyed() && this.visible) wc.send('panel:info', info)
      })
    }, PUSH_DELAY_MS)
  }

  /** Open under the given button, or close if it is already open. */
  toggle(anchor: Rect): void {
    if (this.visible) return this.hide()
    // The click that closed it by taking focus away is this same click: it means "close", not "reopen".
    if (Date.now() - this.blurredAt < 300) return
    this.anchor = anchor
    this.height = 420
    const view = this.ensureView()
    this.place() // after the view exists: it has no size until placed
    this.d.win.contentView.addChildView(view) // on top of the page views
    paintView(view.webContents)
    view.setVisible(true)
    view.webContents.focus()
    if (!view.webContents.isLoading()) view.webContents.send('panel:show')
  }

  hide(): void {
    this.picking = false
    this.view?.setVisible(false)
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view
    const view = new WebContentsView({
      webPreferences: { sandbox: true, preload: join(__dirname, '../preload/panel.js') }
    })
    view.setBackgroundColor('#00000000')
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && dev) void view.webContents.loadURL(`${dev}/panel.html`)
    else void view.webContents.loadFile(join(__dirname, '../renderer/panel.html'))
    view.webContents.on('blur', () => {
      if (this.picking || !this.visible) return
      this.blurredAt = Date.now()
      this.hide()
    })
    this.view = view
    return view
  }

  private place(): void {
    if (!this.view || !this.anchor || this.d.win.isDestroyed()) return
    const [winW, winH] = this.d.win.getContentSize()
    const width = WIDTH + PAD * 2
    const x = Math.max(
      0,
      Math.min(Math.round(this.anchor.x + this.anchor.width) - WIDTH - PAD, winW - width)
    )
    const y = Math.round(this.anchor.y + this.anchor.height + GAP) - PAD
    const height = Math.max(120, Math.min(this.height + PAD * 2, winH - y))
    this.view.setBounds({ x, y: Math.max(0, y), width, height })
  }
}
