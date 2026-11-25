import { is } from '@electron-toolkit/utils'
import { type BrowserWindow, ipcMain, WebContentsView } from 'electron'
import { join } from 'path'
import type { Rect } from '@shared/types'
import { paintView } from './chromeTheme'

/** The bar's card and the room around it for its shadow (find.css #root padding). */
const WIDTH = 380
const HEIGHT = 60
/** From the page's top right corner. */
const INSET = { right: 4, top: 4 }

/** What the find bar needs of the tabs (TabManager). */
export interface FindHost {
  findTarget(): { id: number; rect: Rect } | null
  find(text: string, forward?: boolean): void
  stopFind(): void
  focusPage(): void
  onFind: (() => void) | null
  onFindResult: ((r: { active: number; matches: number }) => void) | null
  onLayout: (() => void) | null
}

/**
 * Find in page in the tab view, as Chrome's: a bar floating over the top right of the page it searches. Pages are native
 * views that paint over anything the window draws, so the bar is a small transparent view of its own, kept on top and
 * moved with its page. It closes when that page is no longer the one in front (another tab, the board).
 */
export class FindFloat {
  private view: WebContentsView | null = null
  /** The tab it searches while open, else null. */
  private openFor: number | null = null

  constructor(
    private win: BrowserWindow,
    private host: FindHost
  ) {
    host.onFind = () => this.open()
    host.onFindResult = (r) => this.view?.webContents.send('find:result', r)
    host.onLayout = () => this.follow()
    win.on('resize', () => this.follow())
    const fromBar = (e: Electron.IpcMainEvent): boolean => e.sender === this.view?.webContents
    ipcMain.on('find:close', (e) => {
      if (fromBar(e)) this.close(true)
    })
  }

  private ensureView(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view
    const view = new WebContentsView({
      webPreferences: { sandbox: true, preload: join(__dirname, '../preload/find.js') }
    })
    view.setBackgroundColor('#00000000')
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl) void view.webContents.loadURL(`${devUrl}/find.html`)
    else void view.webContents.loadFile(join(__dirname, '../renderer/find.html'))
    view.webContents.on('before-input-event', (e, input) => {
      // Ctrl+F again: select what is typed (the page's own handler never sees it while the bar has the keyboard)
      if (
        input.type === 'keyDown' &&
        (input.control || input.meta) &&
        input.key.toLowerCase() === 'f'
      ) {
        e.preventDefault()
        view.webContents.send('find:focus')
      }
    })
    this.view = view
    return view
  }

  private open(): void {
    const target = this.host.findTarget()
    if (!target || this.win.isDestroyed()) return
    const view = this.ensureView()
    this.openFor = target.id
    this.place(target.rect)
    // re-added: on top of any page view made since
    this.win.contentView.addChildView(view)
    paintView(view.webContents)
    view.setVisible(true)
    view.webContents.focus()
    view.webContents.send('find:focus')
  }

  private place(r: Rect): void {
    const width = Math.min(WIDTH, Math.max(200, r.width))
    this.view?.setBounds({
      x: Math.round(r.x + r.width - width - INSET.right),
      y: Math.round(r.y + INSET.top),
      width,
      height: HEIGHT
    })
  }

  /** Keep to the page it searches; close when that page is no longer in front. */
  private follow(): void {
    if (this.openFor === null) return
    const target = this.host.findTarget()
    if (!target || target.id !== this.openFor) return this.close(false)
    this.place(target.rect)
  }

  /** Put the bar away; `fromBar`: closed in the bar (Esc, x), so the page gets the keyboard back. */
  private close(fromBar: boolean): void {
    if (this.openFor === null) return
    this.openFor = null
    this.view?.setVisible(false)
    if (fromBar) {
      this.host.stopFind()
      this.host.focusPage()
    }
  }
}
