import { BrowserWindow, screen } from 'electron'
import { BROWSER_SOURCES } from '@shared/importers'
import { guideHtml, guideStatusText, type GuideStatus } from '@shared/passwordGuide'
import { currentChromeTheme } from './chromeTheme'

const WIDTH = 360
const CLOSE_AFTER_MS = 6000 // once it has worked: long enough to read how it went

/**
 * While another browser has its password export page open (passwordExport.ts), a small window of Panes' own stays on
 * top beside it with that browser's steps, numbered, and how it is going: waiting for the file, then how many came
 * over. It closes itself a moment after the import. The other browser has the screen, so the steps cannot live in
 * Panes' own window.
 */
export class PasswordGuide {
  private win: BrowserWindow | null = null
  private timer: NodeJS.Timeout | null = null

  open(sourceId: string): void {
    const source = BROWSER_SOURCES.find((b) => b.id === sourceId)
    if (!source) return
    this.close()
    const theme = currentChromeTheme() ?? { scheme: 'dark' as const, vars: {} }
    const steps = source.passwordSteps
    const height = 200 + (steps.length + 1) * 44 // a first guess: it takes its content's height before it shows
    const area = screen.getPrimaryDisplay().workArea
    const win = new BrowserWindow({
      width: WIDTH,
      height,
      x: area.x + area.width - WIDTH - 24,
      y: area.y + 24,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: false,
      title: `Export from ${source.name}`,
      backgroundColor: theme.scheme === 'dark' ? '#1c1c22' : '#ffffff',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    win.setAlwaysOnTop(true, 'floating')
    // its own page only: nothing it shows is a link, and nothing may navigate it anywhere
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
    // as tall as what it says (steps wrap to two lines or not), then shown without taking the keyboard from the browser
    win.webContents.once('did-finish-load', () => {
      void win.webContents
        .executeJavaScript('document.documentElement.scrollHeight')
        .then((h: unknown) => {
          if (win.isDestroyed()) return
          if (typeof h === 'number' && h > 0)
            win.setContentSize(WIDTH, Math.min(Math.ceil(h), area.height - 48))
          win.showInactive()
        })
        .catch(() => !win.isDestroyed() && win.showInactive())
    })
    const html = guideHtml(source.name, steps, theme)
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    this.win = win
  }

  /** How it is going; after the import (or giving up) it closes itself. */
  update(status: GuideStatus): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    const done = status.kind !== 'waiting'
    void win.webContents
      .executeJavaScript(`window.setStatus(${JSON.stringify(guideStatusText(status))}, ${done})`)
      .catch(() => undefined)
    if (done) {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.close(), CLOSE_AFTER_MS)
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const win = this.win
    this.win = null
    if (win && !win.isDestroyed()) win.close()
  }
}
