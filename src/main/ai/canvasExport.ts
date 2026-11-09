import { app, BrowserWindow, dialog, ipcMain, type Rectangle } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'

const TYPES = {
  png: { name: 'Image', ext: 'png' },
  pdf: { name: 'PDF', ext: 'pdf' },
  md: { name: 'Markdown', ext: 'md' }
} as const
type Kind = keyof typeof TYPES

/** A file name from a board's title: no path parts or characters Windows refuses. */
const safeName = (s: unknown): string =>
  [...(typeof s === 'string' ? s : '')]
    .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? ' ' : c))
    .join('')
    .trim()
    .slice(0, 80) || 'Board'

/** One page as tall as the picture is for its width, the picture filling it. */
async function pngToPdf(png: Buffer, w: number, h: number): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true }
  })
  try {
    const html = `<!doctype html><html><head><style>@page{margin:0}html,body{margin:0}img{display:block;width:100vw;height:auto}</style></head><body><img src="data:image/png;base64,${png.toString('base64')}"></body></html>`
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
    const width = 11.69 // inches: A4's long side, the picture's width
    return await win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      pageSize: { width, height: Math.max(1, (width * h) / Math.max(1, w)) }
    })
  } finally {
    win.destroy()
  }
}

/**
 * Exporting the canvas board: a picture of what the board shows (the renderer fits the board and hides its own
 * controls first), as PNG or a one-page PDF, or the Markdown digest the renderer wrote. Always through a save dialog
 * the person answers; nothing for a private or Tor window.
 */
export function registerCanvasExport(win: BrowserWindow, allowed: () => boolean): void {
  const mine = (e: { sender: unknown }): boolean => e.sender === win.webContents && allowed()
  ipcMain.handle('canvas:capture', async (e, rect: unknown) => {
    const r = rect as Partial<Rectangle> | null
    if (!mine(e) || !r || ![r.x, r.y, r.width, r.height].every((v) => Number.isFinite(v)))
      return null
    const box = {
      x: Math.round(r.x!),
      y: Math.round(r.y!),
      width: Math.max(1, Math.round(r.width!)),
      height: Math.max(1, Math.round(r.height!))
    }
    return new Uint8Array((await win.webContents.capturePage(box)).toPNG())
  })
  ipcMain.handle('canvas:save-file', async (e, req: unknown) => {
    const q = (req ?? {}) as { kind?: unknown; name?: unknown; data?: unknown; text?: unknown }
    if (!mine(e) || typeof q.kind !== 'string' || !(q.kind in TYPES)) return false
    const kind = q.kind as Kind
    const t = TYPES[kind]
    const res = await dialog.showSaveDialog(win, {
      defaultPath: join(app.getPath('downloads'), `${safeName(q.name)}.${t.ext}`),
      filters: [{ name: t.name, extensions: [t.ext] }]
    })
    if (res.canceled || !res.filePath) return false
    if (kind === 'md') {
      if (typeof q.text !== 'string') return false
      await writeFile(res.filePath, q.text.slice(0, 5_000_000), 'utf8')
      return true
    }
    if (!(q.data instanceof Uint8Array) || q.data.byteLength < 24) return false
    const png = Buffer.from(q.data)
    if (kind === 'png') await writeFile(res.filePath, png)
    else {
      const size = { w: png.readUInt32BE(16), h: png.readUInt32BE(20) } // the PNG header's IHDR
      await writeFile(res.filePath, await pngToPdf(png, size.w, size.h))
    }
    return true
  })
}
