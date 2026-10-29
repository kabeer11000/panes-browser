import { webFrameMain, type WebContents, type WebFrameMain } from 'electron'
import { JsonStore } from './store'

const VIEWER_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'
const READY_POLL_MS = 150
const READY_TIMEOUT_MS = 15_000
const SAVE_POLL_MS = 1500
const MAX_REMEMBERED = 200

interface Spot {
  y: number
  zoom: number
  at: number
}

/** The viewer's page script: true once the document has been laid out and can be scrolled. */
const READY = `(() => {
  const v = document.querySelector('pdf-viewer')
  const vp = v && v.viewport_
  return !!(vp && vp.getDocumentDimensions && vp.getDocumentDimensions().height > 0)
})()`

/** A slimmer top bar: the viewer sizes everything from one CSS variable on its toolbar. */
const SLIM = `(() => {
  const tb = document.querySelector('pdf-viewer')?.shadowRoot?.querySelector('viewer-toolbar')
  if (!tb || tb.dataset.panesSlim) return
  tb.dataset.panesSlim = '1'
  tb.style.setProperty('--viewer-pdf-toolbar-height', '40px')
  tb.style.setProperty('--cr-icon-button-size', '30px')
  tb.style.setProperty('--cr-icon-size', '18px')
  const style = document.createElement('style')
  style.textContent = '#toolbar { padding: 0 10px; }'
  tb.shadowRoot.appendChild(style)
})()`

const READ = `(() => {
  const vp = document.querySelector('pdf-viewer')?.viewport_
  return vp ? JSON.stringify({ y: vp.position.y, zoom: vp.getZoom() }) : null
})()`

const restore = (spot: Spot): string => `(() => {
  const vp = document.querySelector('pdf-viewer')?.viewport_
  if (!vp) return
  vp.setZoom(${Number(spot.zoom) || 1})
  vp.setPosition({ x: 0, y: ${Math.max(0, Math.round(spot.y))} })
})()`

/** Web address without its fragment: the same document however it was linked. */
export const pdfKey = (url: string): string => url.split('#')[0]

/**
 * Tunes Chromium's built-in PDF viewer, which lives in its own extension frame inside the tab: a
 * thinner toolbar, and a remembered reading position per document so reopening, reloading or coming
 * back to an unloaded tab lands where you left off.
 */
export class PdfViewerHelper {
  private store = new JsonStore<Record<string, Spot>>('pdf-positions', {})

  attach(wc: WebContents): void {
    wc.on('did-frame-finish-load', (_e, isMainFrame, processId, routingId) => {
      if (isMainFrame) return
      const frame = webFrameMain.fromId(processId, routingId)
      if (frame?.url.startsWith(VIEWER_ORIGIN)) void this.tune(wc, frame)
    })
  }

  private async tune(wc: WebContents, frame: WebFrameMain): Promise<void> {
    const run = async (code: string): Promise<unknown> => {
      try {
        return await frame.executeJavaScript(code)
      } catch {
        return null // the frame went away: the tab navigated or closed
      }
    }
    const started = Date.now()
    while (!(await run(READY))) {
      if (frame.detached || wc.isDestroyed() || Date.now() - started > READY_TIMEOUT_MS) return
      await new Promise((r) => setTimeout(r, READY_POLL_MS))
    }
    await run(SLIM)

    const url = wc.getURL()
    const key = pdfKey(url)
    // A link that names a page (#page=3) is asking for that page, not for where you were.
    const saved = this.store.value[key]
    if (saved && !/#(.*&)?page=/.test(url)) await run(restore(saved))

    // Remember where you are while you read.
    const timer = setInterval(() => {
      if (frame.detached || wc.isDestroyed()) return clearInterval(timer)
      void run(READ).then((raw) => {
        if (typeof raw !== 'string') return
        const pos = JSON.parse(raw) as { y: number; zoom: number }
        const prev = this.store.value[key]
        if (prev ? prev.y === pos.y && prev.zoom === pos.zoom : pos.y === 0) return
        this.store.value[key] = { ...pos, at: Date.now() }
        this.trim()
        this.store.save()
      })
    }, SAVE_POLL_MS)
  }

  /** Keep the most recently read documents only. */
  private trim(): void {
    const entries = Object.entries(this.store.value)
    if (entries.length <= MAX_REMEMBERED) return
    entries.sort((a, b) => b[1].at - a[1].at)
    this.store.value = Object.fromEntries(entries.slice(0, MAX_REMEMBERED))
  }
}
