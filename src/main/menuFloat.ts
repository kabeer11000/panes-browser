import { is } from '@electron-toolkit/utils'
import {
  type BrowserWindow,
  ipcMain,
  type MenuItemConstructorOptions,
  screen,
  type WebContents,
  webContents,
  WebContentsView
} from 'electron'
import { join } from 'path'
import { fromTemplate } from '@shared/menu'
import type { MenuShow } from '@shared/types'
import { paintView } from './chromeTheme'

/** The menu's way out (ContextMenu's OUT_MS, and a frame): the view goes once it has played. */
const HIDE_MS = 130

export interface PopupOptions {
  /** In the window's content, as Menu.popup's; the pointer when left out. */
  x?: number
  y?: number
  /** Quiet words at the top: what the menu is about. */
  title?: string
  /** It ends at the point rather than starting there (a button low in the window). */
  up?: boolean
  /** Once it is closed, after the picked item's click (as Menu.popup's callback). */
  callback?: () => void
}

/**
 * Right-click menus drawn by Panes (the board's ContextMenu) in place of the system's: for pages, tabs and the rest.
 * Pages are native views that paint over the window's own UI, so the menu is a transparent view over the whole window,
 * on top of everything; a press outside the menu lands on it and closes the menu, as a system menu takes that press.
 * Items are Electron menu templates, so callers stay as they were (popupMenu for Menu.buildFromTemplate().popup()).
 */
class MenuFloat {
  private view: WebContentsView | null = null
  private seq = 0
  private open: {
    seq: number
    clicks: Map<string, () => void>
    callback?: () => void
    /** What had the keyboard, given it back on close. */
    focus: WebContents | null
  } | null = null
  private hideTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private win: BrowserWindow) {
    win.on('resize', () => {
      this.fit()
      // the menu goes as the window resizes (its view does not close it: see ContextMenu's closeOnResize)
      if (this.open) this.hide()
    })
    win.on('closed', () => floats.delete(win))
    const mine = (e: Electron.IpcMainEvent, seq: unknown): boolean =>
      e.sender === this.view?.webContents && seq === this.open?.seq
    ipcMain.on('menu:pick', (e, seq: unknown, id: unknown) => {
      if (!mine(e, seq) || typeof id !== 'string') return
      // the keyboard back first: Paste, Undo and the like act on the focused part of their page
      const f = this.open?.focus
      if (f && !f.isDestroyed()) f.focus()
      this.open?.clicks.get(id)?.()
    })
    ipcMain.on('menu:close', (e, seq: unknown) => {
      if (mine(e, seq)) this.close()
    })
    // made ahead, so the first menu opens at once
    setTimeout(() => this.ensureView(), 4000)
  }

  private ensureView(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view
    const view = new WebContentsView({
      webPreferences: { sandbox: true, preload: join(__dirname, '../preload/menu.js') }
    })
    view.setBackgroundColor('#00000000')
    view.setVisible(false)
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl) void view.webContents.loadURL(`${devUrl}/menu.html`)
    else void view.webContents.loadFile(join(__dirname, '../renderer/menu.html'))
    view.webContents.on('render-process-gone', () => {
      if (this.view === view) this.view = null
      this.finish()
    })
    this.view = view
    this.fit()
    return view
  }

  private fit(): void {
    if (this.win.isDestroyed()) return
    const [width, height] = this.win.getContentSize()
    this.view?.setBounds({ x: 0, y: 0, width, height })
  }

  popup(items: MenuItemConstructorOptions[], o: PopupOptions): void {
    if (this.win.isDestroyed()) return
    // one at a time: a menu asked for while one is up takes its place
    if (this.open) this.finish()
    const { entries, clicks } = fromTemplate(items, process.platform === 'darwin')
    if (entries.length === 0) return o.callback?.()
    const at = (): { x: number; y: number } => {
      if (o.x !== undefined && o.y !== undefined) return { x: o.x, y: o.y }
      const p = screen.getCursorScreenPoint()
      const c = this.win.getContentBounds()
      return { x: p.x - c.x, y: p.y - c.y }
    }
    const { x, y } = at()
    clearTimeout(this.hideTimer)
    const seq = ++this.seq
    const view = this.ensureView()
    this.open = { seq, clicks, callback: o.callback, focus: focused(view.webContents) }
    this.fit()
    // on top of any view made since; re-adding one already on top detaches and reattaches it, a rebuilt surface just
    // as the menu starts to grow (a stutter)
    const kids = this.win.contentView.children
    if (kids[kids.length - 1] !== view) this.win.contentView.addChildView(view)
    paintView(view.webContents)
    view.setVisible(true)
    view.webContents.focus()
    const show: MenuShow = { seq, x, y, title: o.title, up: o.up, items: entries }
    const send = (): void => {
      if (this.open?.seq === seq && !view.webContents.isDestroyed())
        view.webContents.send('menu:show', show)
    }
    if (view.webContents.isLoading()) view.webContents.once('did-finish-load', send)
    else send()
  }

  /** Gone at once, nothing played. */
  private hide(): void {
    this.finish()
    clearTimeout(this.hideTimer)
    const view = this.view
    if (!view || view.webContents.isDestroyed()) return
    view.setVisible(false)
    // drawn no longer, or the next menu would show this one for a frame
    view.webContents.send('menu:show', null)
  }

  /** Closed in the view: it plays its way out, then the view goes. */
  private close(): void {
    this.finish()
    const view = this.view
    clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => view?.setVisible(false), HIDE_MS)
  }

  /** The menu is over: the keyboard goes back, the caller hears. */
  private finish(): void {
    const open = this.open
    if (!open) return
    this.open = null
    if (open.focus && !open.focus.isDestroyed()) open.focus.focus()
    open.callback?.()
  }
}

/** The web contents with the keyboard, unless it is the menu's own. */
function focused(own: WebContents): WebContents | null {
  const wc = webContents.getFocusedWebContents()
  return wc && wc !== own ? wc : null
}

const floats = new Map<BrowserWindow, MenuFloat>()

function floatOf(win: BrowserWindow): MenuFloat {
  let f = floats.get(win)
  if (!f) floats.set(win, (f = new MenuFloat(win)))
  return f
}

/** At the window's start: its menu view is then made ahead (after a few seconds), so the first right-click does not
 * wait for a page to load. Made at that click, the first menu came late and stuttered in. */
export function prepareMenus(win: BrowserWindow): void {
  floatOf(win)
}

/** A Panes-drawn menu from an Electron template, where Menu.buildFromTemplate(items).popup({ window, ... }) was. */
export function popupMenu(
  win: BrowserWindow,
  items: MenuItemConstructorOptions[],
  o: PopupOptions = {}
): void {
  floatOf(win).popup(items, o)
}
