import { randomUUID } from 'crypto'
import type { BrowserWindow, WebContents } from 'electron'
import { READER_SCRIPT } from '@shared/printCopy'
import { canRead, readerSource, readerUrl, type ReaderArticle } from '@shared/reader'
import { addCardToBoard } from './ai/canvasAssistant'
import { handleInternal } from './internal'

const KEPT = 30 // articles kept in memory; the oldest goes first

interface Deps {
  win: BrowserWindow
  active: () => WebContents | null
  inCanvas: () => boolean
  /** The tab on screen is a normal one: a private or Tor page is never put on the board. */
  normal: () => boolean
}

/**
 * Reader mode (Ctrl+Shift+E, the command bar, the address bar's button): the page's text is read with the print
 * dialog's Simplify script and shown in panes://reader in the same tab; toggling again goes back to the page. Articles
 * stay in memory only, under a random key that only the reader page opened with it knows, so a private tab's article is
 * never written anywhere nor reachable from another tab.
 */
export class Reader {
  private articles = new Map<string, ReaderArticle>()

  constructor(private d: Deps) {
    handleInternal('int:reader-get', (key: unknown) => {
      const a = typeof key === 'string' ? this.articles.get(key) : undefined
      return a ? { ...a, canvas: this.d.normal() } : null
    })
    handleInternal('int:reader-exit', () => void this.toggle())
    handleInternal('int:reader-canvas', (key: unknown) => {
      const a = typeof key === 'string' ? this.articles.get(key) : undefined
      return a ? this.toCanvas(a.url) : false
    })
  }

  async toggle(): Promise<void> {
    const wc = this.d.active()
    if (!wc) return
    const url = wc.getURL()
    const source = readerSource(url)
    if (source) {
      const nav = wc.navigationHistory
      const i = nav.getActiveIndex()
      const prev = i > 0 ? nav.getEntryAtIndex(i - 1) : null
      if (prev?.url === source) nav.goBack()
      else void wc.loadURL(source)
      return
    }
    if (!canRead(url)) return
    const r = (await wc.executeJavaScript(READER_SCRIPT).catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!r) return // the page is gone or refused: stay on it
    const text = (v: unknown): string => (typeof v === 'string' ? v : '')
    if (wc.isDestroyed() || wc.getURL() !== url) return // it navigated away while being read
    const key = randomUUID()
    this.articles.set(key, { title: text(r?.title), url, html: text(r?.html) })
    while (this.articles.size > KEPT) this.articles.delete(this.articles.keys().next().value!)
    void wc.loadURL(readerUrl(url, key))
  }

  private async toCanvas(url: string): Promise<boolean> {
    if (!this.d.inCanvas()) this.d.win.webContents.send('ui:command', 'toggle-canvas')
    return addCardToBoard(url)
  }
}
