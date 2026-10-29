import { is } from '@electron-toolkit/utils'
import { type BrowserWindow, WebContentsView, type WebContents } from 'electron'
import { join } from 'path'
import type { PasswordPrompt, PopoverState, PromptAnchor } from '../shared/types'
import { paintView } from './chromeTheme'

const CARD_WIDTH = 296
const PAD = 14 // room around the card for its shadow, so the view never clips it
const GAP = 4 // between the address bar and the card
const DEFAULT_THEME: PromptAnchor['theme'] = { scheme: 'dark', color: '#6e7bff', color2: '#6e7bff' }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/**
 * The save-password card as a popover. Page views are native views that paint above the window's own
 * UI, so it lives in a transparent view of its own, stacked on top and hung under the address bar.
 */
export class PromptPopover {
  private view: WebContentsView | null = null
  private prompt: PasswordPrompt | null = null
  private anchor: PromptAnchor | null = null
  private height = 200

  constructor(private win: BrowserWindow) {
    win.on('resize', () => this.sync())
  }

  /** The popover's own web contents, so IPC handlers can recognise it as a trusted sender. */
  get contents(): WebContents | null {
    return this.view?.webContents ?? null
  }

  state(): PopoverState {
    return { prompt: this.prompt, theme: this.anchor?.theme ?? DEFAULT_THEME }
  }

  setPrompt(prompt: PasswordPrompt | null): void {
    this.prompt = prompt
    this.sync()
  }

  setAnchor(anchor: PromptAnchor | null): void {
    this.anchor = anchor
    this.sync()
  }

  setHeight(height: number): void {
    if (!finite(height) || height < 0) return
    this.height = Math.ceil(Math.min(height, 600))
    this.sync()
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view
    const view = new WebContentsView({
      webPreferences: { sandbox: true, preload: join(__dirname, '../preload/popover.js') }
    })
    view.setBackgroundColor('#00000000')
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl) void view.webContents.loadURL(`${devUrl}/popover.html`)
    else void view.webContents.loadFile(join(__dirname, '../renderer/popover.html'))
    this.view = view
    return view
  }

  private sync(): void {
    if (this.win.isDestroyed()) return
    if (!this.prompt || !this.anchor) {
      this.view?.setVisible(false)
      return
    }
    const view = this.ensureView()
    const [winW, winH] = this.win.getContentSize()
    const width = CARD_WIDTH + PAD * 2
    const height = Math.min(this.height + PAD * 2, winH)
    // Left edges line up with the address bar; the card slides left rather than leaving the window.
    const x = Math.max(0, Math.min(Math.round(this.anchor.x) - PAD, winW - width))
    const y = Math.round(this.anchor.y + this.anchor.height + GAP) - PAD
    view.setBounds({ x, y, width, height })
    // Re-adding moves it to the top, above any tab views created since it was last shown.
    this.win.contentView.addChildView(view)
    paintView(view.webContents)
    view.setVisible(true)
    if (!view.webContents.isLoading()) view.webContents.send('popover:state', this.state())
  }
}
