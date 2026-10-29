import { is } from '@electron-toolkit/utils'
import { ipcMain, type BrowserWindow, WebContentsView, type WebContents } from 'electron'
import { join } from 'path'
import type { TabCardInfo, TabHoverAnchor } from '../shared/types'
import { paintView } from './chromeTheme'

const CARD_WIDTH = 264
// Room around the card for its shadow, so the view never clips it. The side facing the tab has the least, so the
// (transparent, mouse-catching) view stays off the tab: the card sits PAD_T below it or PAD_L beside it. The bottom
// room (24px) is in the card's CSS, since the view's height comes from the card.
const PAD_T = 8
const PAD_R = 20
const PAD_L = 12

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

function parseAnchor(raw: unknown): TabHoverAnchor | null {
  const a = raw as Partial<TabHoverAnchor> | null
  if (!a || !finite(a.x) || !finite(a.y) || !finite(a.width) || !finite(a.height)) return null
  const side = a.side === 'right' ? 'right' : 'below'
  return { x: a.x, y: a.y, width: a.width, height: a.height, side }
}

/**
 * The card that rests beside a hovered tab. Page views are native views that paint above the window's own UI,
 * so it lives in a transparent view of its own. What it says is asked for only when a card opens: nothing
 * runs while no tab is hovered.
 */
class TabCard {
  private view: WebContentsView | null = null
  private info: TabCardInfo | null = null
  private anchor: TabHoverAnchor | null = null
  private height = 120

  constructor(private win: BrowserWindow) {}

  /** The card's own web contents, so IPC handlers can recognise it as a trusted sender. */
  get contents(): WebContents | null {
    return this.view?.webContents ?? null
  }

  state(): TabCardInfo | null {
    return this.info
  }

  setHeight(height: number): void {
    if (!finite(height) || height < 0) return
    this.height = Math.ceil(Math.min(height, 400))
    this.place()
  }

  show(info: TabCardInfo, anchor: TabHoverAnchor): void {
    if (this.win.isDestroyed()) return
    this.info = info
    this.anchor = anchor
    const view = this.ensureView()
    this.place()
    // Re-adding moves it to the top, above any tab views created since it was last shown.
    this.win.contentView.addChildView(view)
    paintView(view.webContents)
    view.setVisible(true)
    if (!view.webContents.isLoading()) view.webContents.send('tabcard:state', info)
  }

  hide(): void {
    if (!this.info) return
    console.log('[tabcard] hide', new Error().stack?.split('\n').slice(2, 5).join(' | '))
    this.info = null
    this.anchor = null
    this.view?.setVisible(false)
    if (this.view && !this.view.webContents.isLoading()) {
      this.view.webContents.send('tabcard:state', null)
    }
  }

  private place(): void {
    if (!this.anchor || !this.view) return
    const { x: ax, y: ay, width: aw, height: ah, side } = this.anchor
    const [winW, winH] = this.win.getContentSize()
    const width = PAD_L + CARD_WIDTH + PAD_R
    const height = Math.min(this.height, winH)
    const left = side === 'right' ? ax + aw : ax - PAD_L
    const top = side === 'right' ? ay - PAD_T : ay + ah
    const x = Math.max(0, Math.min(Math.round(left), winW - width))
    const y = Math.max(0, Math.min(Math.round(top), winH - height))
    this.view.setBounds({ x, y, width, height })
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view
    const view = new WebContentsView({
      webPreferences: { sandbox: true, preload: join(__dirname, '../preload/tabcard.js') }
    })
    view.setBackgroundColor('#00000000')
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl) void view.webContents.loadURL(`${devUrl}/tabcard.html`)
    else void view.webContents.loadFile(join(__dirname, '../renderer/tabcard.html'))
    this.view = view
    return view
  }
}

/** Hover cards for tabs: the window says when the pointer rests on a tab, `describe` says what to show. */
export function registerTabCard(
  win: BrowserWindow,
  describe: (id: number) => TabCardInfo | null
): void {
  const card = new TabCard(win)
  ipcMain.on('tabs:hover', (e, id: unknown, raw: unknown) => {
    if (e.sender !== win.webContents) return
    const anchor = parseAnchor(raw)
    const info = typeof id === 'number' && anchor ? describe(id) : null
    if (info && anchor) card.show(info, anchor)
    else card.hide()
  })
  ipcMain.handle('tabcard:state', (e) => (e.sender === card.contents ? card.state() : null))
  ipcMain.on('tabcard:resize', (e, height: unknown) => {
    if (e.sender === card.contents && typeof height === 'number') card.setHeight(height)
  })
  win.on('blur', () => card.hide())
}
