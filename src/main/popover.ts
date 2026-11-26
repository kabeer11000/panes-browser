import { is } from '@electron-toolkit/utils'
import { type BrowserWindow, WebContentsView, type WebContents } from 'electron'
import { join } from 'path'
import type { PasswordPrompt, PopoverState, PromptAnchor } from '@shared/types'
import { PROMPT_CARD_WIDTH, PROMPT_PAD } from '@shared/anchor'
import { releaseHelper } from '@shared/memory'
import { paintView } from './chromeTheme'

const GAP = 8 // between the address bar and the card (styles.css --pop-gap)
const DEFAULT_THEME: PromptAnchor['theme'] = { scheme: 'dark', color: '#6e7bff', color2: '#6e7bff' }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/**
 * The save-password card as a popover. Page views are native views that paint above the window's own
 * UI, so it lives in a transparent view of its own, stacked on top and hung under the address bar.
 */
export class PromptPopover {
  private view: WebContentsView | null = null
  /** When it was last shown (see release). */
  private lastUsedAt = 0
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

  /**
   * Give back its renderer process if it is hidden and has gone unused a while and memory is short (releaseHelper);
   * it is made again the next time it is needed. True when it was let go.
   */
  release(roomy: boolean): boolean {
    const view = this.view
    if (
      !releaseHelper({
        exists: !!view,
        visible: !!view?.getVisible(),
        lastUsedAt: this.lastUsedAt,
        now: Date.now(),
        roomy
      })
    )
      return false
    this.view = null
    try {
      this.win.contentView.removeChildView(view!)
    } catch {
      // not a child (never shown)
    }
    if (!view!.webContents.isDestroyed()) view!.webContents.close()
    return true
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
      if (this.view?.getVisible()) this.lastUsedAt = Date.now()
      this.view?.setVisible(false)
      return
    }
    const view = this.ensureView()
    const [winW, winH] = this.win.getContentSize()
    // The view is the card plus room for its shadow on every side (PROMPT_PAD), so the shadow is never clipped.
    const width = PROMPT_CARD_WIDTH + PROMPT_PAD.side * 2
    const height = Math.min(this.height + PROMPT_PAD.top + PROMPT_PAD.bottom, winH)
    // Left edges line up with the address bar; the card slides left rather than leaving the window.
    const x = Math.max(0, Math.min(Math.round(this.anchor.x) - PROMPT_PAD.side, winW - width))
    const y = Math.max(0, Math.round(this.anchor.y + this.anchor.height + GAP) - PROMPT_PAD.top)
    view.setBounds({ x, y, width, height })
    // Re-adding moves it to the top, above any tab views created since it was last shown.
    this.win.contentView.addChildView(view)
    paintView(view.webContents)
    view.setVisible(true)
    if (!view.webContents.isLoading()) view.webContents.send('popover:state', this.state())
    this.lastUsedAt = Date.now()
  }
}
