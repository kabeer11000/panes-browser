import { type BrowserWindow, ipcMain, type View, WebContentsView, type WebContents } from 'electron'
import type { BackdropLayer, Rect } from '@shared/types'

/**
 * Frosted glass for Panes' floating views (site settings, menus over pages, permission cards, the downloads fan...).
 * Each is a view of its own above the pages, and a view cannot blur what is under it: it would only be see-through.
 * So a floating view asks here for what is under its cards, and gets live sources for the window's own interface and
 * every view shown beneath it (the pages, mostly), placed relative to itself. It plays them, blurred, behind its cards
 * (renderer components/Backdrop.tsx). Only while a card is shown: the streams stop as it closes.
 */
const windows = new Set<BrowserWindow>()
let registered = false

/** Panes' own pages only (the floating views), never a web page. */
function ours(wc: WebContents): boolean {
  const url = wc.getURL()
  const dev = process.env['ELECTRON_RENDERER_URL']
  return (!!dev && url.startsWith(dev)) || url.startsWith('file:')
}

const meets = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** What is under `area` (in the asking view's own coordinates), bottom first. */
function layersUnder(win: BrowserWindow, asker: WebContents, area: Rect): BackdropLayer[] | null {
  const kids: View[] = win.contentView.children
  const at = kids.findIndex((v) => v instanceof WebContentsView && v.webContents === asker)
  if (at < 0) return null
  const me = kids[at].getBounds()
  // the area in the window's coordinates
  const want = { x: area.x + me.x, y: area.y + me.y, width: area.width, height: area.height }
  const [width, height] = win.getContentSize()
  const source = (wc: WebContents): string | null => {
    try {
      return wc.getMediaSourceId(asker)
    } catch {
      return null
    }
  }
  const layers: BackdropLayer[] = []
  const add = (wc: WebContents, r: Rect): void => {
    if (!meets(r, want)) return
    const id = source(wc)
    if (id)
      layers.push({ source: id, x: r.x - me.x, y: r.y - me.y, width: r.width, height: r.height })
  }
  add(win.webContents, { x: 0, y: 0, width, height })
  for (const v of kids.slice(0, at)) {
    if (!(v instanceof WebContentsView) || !v.getVisible() || v.webContents.isDestroyed()) continue
    const r = v.getBounds()
    if (r.width > 0 && r.height > 0) add(v.webContents, r)
  }
  return layers
}

export function registerBackdrop(win: BrowserWindow): void {
  if (!registered) {
    registered = true
    ipcMain.handle('float:backdrop', (e, area: unknown) => {
      const a = area as Rect | null
      if (!a || ![a.x, a.y, a.width, a.height].every(Number.isFinite) || !ours(e.sender))
        return null
      for (const w of windows) {
        if (w.isDestroyed()) continue
        const layers = layersUnder(w, e.sender, a)
        if (layers) return layers
      }
      return null
    })
  }
  windows.add(win)
  win.on('closed', () => windows.delete(win))
}
