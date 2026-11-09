import { is } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  WebContentsView,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import type { PrintInit } from '@shared/types'
import {
  countPdfPages,
  normalizeOptions,
  PDF_DESTINATION,
  pdfFileName,
  remembered,
  resolvePages,
  toPdfOptions,
  toPrinterOptions,
  type PrintOptions
} from '@shared/print'
import {
  COPY_SCRIPT,
  hostKey,
  mergeOptions,
  needsCopy,
  printCss,
  READER_SCRIPT,
  readerDocument,
  rememberHost
} from '@shared/printCopy'
import { paintView } from './chromeTheme'
import { JsonStore } from './store'

interface Deps {
  win: BrowserWindow
  /** The page on screen, and whether what is chosen here may be remembered (not in a private or Tor tab). */
  target: () => { wc: WebContents; persist: boolean } | null
}

type Reply = { ok: boolean; message?: string }
const LOAD_TIMEOUT_MS = 8000

/** A copy of the page in a window nobody sees, made for one set of print choices. */
interface Copy {
  win: BrowserWindow
  file: string
}

/**
 * Ctrl+P: a view over the whole window (page views are native and paint above the window's own UI, so it needs a view
 * of its own). The page is rendered to a PDF with the chosen options and drawn in the view; "Save" writes that PDF,
 * "Print" sends it to the chosen printer. A simplified page, or one without pictures or with a light background, is
 * printed from a hidden copy of it, so the page on screen is never changed. The choices are kept per site and overall,
 * except in private and Tor tabs, which keep nothing.
 */
export class PrintDialog {
  private view: WebContentsView | null = null
  private wc: WebContents | null = null
  private persist = false
  private pages = 0
  private copies = new Map<string, Promise<Copy | null>>()
  private copyCount = 0
  private store = new JsonStore<{
    last: Partial<PrintOptions>
    hosts: Record<string, Partial<PrintOptions>>
  }>('print', { last: {}, hosts: {} })

  constructor(private d: Deps) {
    const fromDialog = (e: IpcMainEvent | IpcMainInvokeEvent): boolean =>
      !!this.view && e.sender === this.view.webContents
    ipcMain.handle('print:init', (e) => (fromDialog(e) ? this.init() : null))
    ipcMain.handle('print:preview', (e, o: unknown) => (fromDialog(e) ? this.preview(o) : null))
    ipcMain.handle('print:run', (e, o: unknown) =>
      fromDialog(e) ? this.run(o) : { ok: false, message: 'Not available' }
    )
    ipcMain.handle('print:system', (e, o: unknown) =>
      fromDialog(e) ? this.system(o) : { ok: false, message: 'Not available' }
    )
    ipcMain.on('print:close', (e) => fromDialog(e) && this.hide())
    ipcMain.on('print:window', (e, action: unknown) => {
      if (!fromDialog(e)) return
      if (action === 'minimize') this.d.win.minimize()
      else if (action === 'maximize')
        this.d.win.isMaximized() ? this.d.win.unmaximize() : this.d.win.maximize()
      else if (action === 'close') this.d.win.close()
    })
    d.win.on('resize', () => this.fit())
    d.win.on('closed', () => void this.dispose())
  }

  get visible(): boolean {
    return !!this.view?.getVisible()
  }

  open(): void {
    const t = this.d.target()
    if (!t || this.visible) return
    this.wc = t.wc
    this.persist = t.persist
    this.pages = 0
    const view = this.ensureView()
    this.fit()
    this.d.win.contentView.addChildView(view) // above the page views
    paintView(view.webContents)
    view.setVisible(true)
    view.webContents.focus()
    if (!view.webContents.isLoading()) view.webContents.send('print:open')
  }

  /** Ctrl+Shift+P: the system's own print dialog for the page, with nothing of ours in between. */
  openSystem(): void {
    this.d.target()?.wc.print()
  }

  hide(): void {
    this.view?.setVisible(false)
    this.wc = null
    void this.dispose()
    this.d.win.webContents.focus()
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view
    const view = new WebContentsView({
      webPreferences: { sandbox: true, preload: join(__dirname, '../preload/print.js') }
    })
    view.setBackgroundColor('#00000000')
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && dev) void view.webContents.loadURL(`${dev}/print.html`)
    else void view.webContents.loadFile(join(__dirname, '../renderer/print.html'))
    this.view = view
    return view
  }

  private fit(): void {
    if (!this.view || this.d.win.isDestroyed()) return
    const [width, height] = this.d.win.getContentSize()
    this.view.setBounds({ x: 0, y: 0, width, height })
  }

  /** The page the dialog is for, or null when it has gone since. */
  private live(): WebContents | null {
    return this.wc && !this.wc.isDestroyed() ? this.wc : null
  }

  // ---- the page, or a hidden copy of it ----

  /** What to print for these choices: the page itself, or a copy made (once) for them. */
  /** The live page's title and address for the header and footer, when printing from a copy of it. */
  private edges(
    live: WebContents,
    src: WebContents
  ): { title: string; url: string; date: string } | undefined {
    if (src === live) return undefined
    return { title: live.getTitle(), url: live.getURL(), date: new Date().toLocaleString() }
  }

  private async sourceFor(live: WebContents, o: PrintOptions): Promise<WebContents | null> {
    if (!needsCopy(o)) return live
    const key = `${o.simplify}|${o.noImages}|${o.lightBackground}`
    let made = this.copies.get(key)
    if (!made) {
      made = this.makeCopy(live, o).catch(() => null)
      this.copies.set(key, made)
    }
    const copy = await made
    return copy && !copy.win.isDestroyed() ? copy.win.webContents : null
  }

  private async makeCopy(live: WebContents, o: PrintOptions): Promise<Copy> {
    let html: string
    if (o.simplify) {
      const r = (await live.executeJavaScript(READER_SCRIPT)) as Record<string, unknown>
      const text = (v: unknown): string => (typeof v === 'string' ? v : '')
      html = readerDocument(
        { title: text(r?.title), url: text(r?.url), html: text(r?.html) },
        new Date().toLocaleDateString(undefined, { dateStyle: 'long' })
      )
    } else {
      html = String(await live.executeJavaScript(COPY_SCRIPT))
    }
    const file = join(app.getPath('temp'), `panes-print-${process.pid}-${++this.copyCount}.html`)
    await writeFile(file, html, 'utf8')
    // no script runs in the copy, and it loads what it needs through the page's own session (a private tab stays private)
    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 1400,
      webPreferences: { sandbox: true, javascript: false, session: live.session }
    })
    const loaded = new Promise<void>((resolve) => {
      win.webContents.once('did-finish-load', () => resolve())
      setTimeout(resolve, LOAD_TIMEOUT_MS)
    })
    void win.loadFile(file)
    await loaded
    const css = printCss(o)
    if (css) await win.webContents.insertCSS(css)
    return { win, file }
  }

  private async dispose(): Promise<void> {
    const all = [...this.copies.values()]
    this.copies.clear()
    for (const made of all) {
      const copy = await made
      if (!copy) continue
      if (!copy.win.isDestroyed()) copy.win.destroy()
      void unlink(copy.file).catch(() => undefined)
    }
  }

  // ---- dialog calls ----

  private async init(): Promise<PrintInit | null> {
    const wc = this.live()
    if (!wc) return null
    const printers = await this.d.win.webContents.getPrintersAsync().catch(() => [])
    const { last, hosts } = this.store.value
    const options = mergeOptions(last, hosts[hostKey(wc.getURL())])
    // a printer that has been unplugged since is not offered again
    if (
      options.destination !== PDF_DESTINATION &&
      !printers.some((p) => p.name === options.destination)
    )
      options.destination = PDF_DESTINATION
    return {
      options,
      printers: printers.map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: !!(p.options as Record<string, unknown> | undefined)?.['printer-is-default'] // ponytail: key is CUPS-style; unset on Windows, so no default marker there
      })),
      title: wc.getTitle(),
      url: wc.getURL(),
      snapshot: await this.snapshot(wc),
      remembers: this.persist
    }
  }

  private async snapshot(wc: WebContents): Promise<string | null> {
    try {
      const img = await wc.capturePage()
      if (img.isEmpty()) return null
      return `data:image/jpeg;base64,${img.resize({ width: 480 }).toJPEG(55).toString('base64')}`
    } catch {
      return null
    }
  }

  private async preview(raw: unknown): Promise<{ pdf: string; pages: number } | null> {
    const live = this.live()
    if (!live) return null
    const o = normalizeOptions(raw)
    try {
      const src = await this.sourceFor(live, o)
      if (!src) return null
      const buf = await src.printToPDF(toPdfOptions(o, [], this.edges(live, src)))
      this.pages = countPdfPages(buf)
      return { pdf: buf.toString('base64'), pages: this.pages }
    } catch {
      return null
    }
  }

  /** Print or save. `savePath` skips the Save As dialog (used by checks). */
  async run(raw: unknown, savePath?: string): Promise<Reply> {
    const live = this.live()
    if (!live) return { ok: false, message: 'The page was closed' }
    const o = normalizeOptions(raw)
    const r = resolvePages(o, this.pages || undefined)
    if (!r.ok) return { ok: false, message: r.error }
    this.remember(live, o)
    try {
      const src = await this.sourceFor(live, o)
      if (!src) return { ok: false, message: 'The page could not be prepared for printing' }
      if (o.destination === PDF_DESTINATION)
        return await this.save(live, src, o, r.ranges, savePath)
      return await new Promise((resolve) =>
        src.print(toPrinterOptions(o, r.ranges, this.pages || 9999), (ok, why) =>
          resolve(
            ok
              ? { ok: true, message: 'Sent to the printer' }
              : { ok: false, message: why || 'The printer did not take the job' }
          )
        )
      )
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Printing failed' }
    }
  }

  /** The system's print dialog, for the page as it is chosen here. Resolves when that dialog is done. */
  private async system(raw: unknown): Promise<Reply> {
    const live = this.live()
    if (!live) return { ok: false, message: 'The page was closed' }
    const o = normalizeOptions(raw)
    this.remember(live, o)
    const src = await this.sourceFor(live, o)
    if (!src) return { ok: false, message: 'The page could not be prepared for printing' }
    return new Promise((resolve) =>
      src.print({ printBackground: o.background, landscape: o.landscape }, (ok, why) =>
        resolve({ ok, message: ok || why === 'cancelled' ? undefined : why })
      )
    )
  }

  private remember(live: WebContents, o: PrintOptions): void {
    if (!this.persist) return // private and Tor tabs leave nothing behind
    const v = this.store.value
    v.last = remembered(o)
    v.hosts = rememberHost(v.hosts, hostKey(live.getURL()), o)
    this.store.save()
  }

  private async save(
    live: WebContents,
    src: WebContents,
    o: PrintOptions,
    ranges: Parameters<typeof toPdfOptions>[1],
    savePath?: string
  ): Promise<Reply> {
    let path = savePath
    if (!path) {
      const pick = await dialog.showSaveDialog(this.d.win, {
        defaultPath: join(app.getPath('downloads'), pdfFileName(live.getTitle(), live.getURL())),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (pick.canceled || !pick.filePath) return { ok: false }
      path = pick.filePath
    }
    await writeFile(path, await src.printToPDF(toPdfOptions(o, ranges, this.edges(live, src))))
    return { ok: true, message: 'Saved' }
  }
}
