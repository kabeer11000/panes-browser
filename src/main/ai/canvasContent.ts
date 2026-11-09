import { app, BrowserWindow, type WebContents } from 'electron'
import { createHash } from 'crypto'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  ITEM_TEXT_MAX,
  pdfSource,
  type CanvasPageContent,
  type CanvasReaderBlock,
  type CanvasReaderDoc
} from '@shared/ai/canvasItems'
import type { DownloadManager } from '../downloads'
import type { TabManager } from '../tabs'

/** The most a PDF or picture fetched for a card may weigh. */
export const BYTES_MAX = 60 * 1024 * 1024
const CACHE_MAX = 300
const SCRIPT_MS = 2500
const LOAD_MS = 12_000

/**
 * Read from the page, once, by a fixed string (nothing a model or a page says is ever run). The card shows what
 * this returns: a headline, a site, a hero picture and the first lines of the article.
 */
const CARD_SCRIPT = `(() => {
  const q = (s) => document.querySelector(s)
  const meta = (n) => { const m = q('meta[property="' + n + '"],meta[name="' + n + '"]'); return m ? (m.content || '').trim() : '' }
  const abs = (u) => { try { return new URL(u, location.href).href } catch (e) { return '' } }
  const root = q('article') || q('main') || document.body
  const paras = [...root.querySelectorAll('p')].map((p) => (p.innerText || '').trim()).filter((t) => t.length > 60)
  let text = paras.slice(0, 4).join(' ')
  if (!text) text = (root.innerText || '')
  text = text.replace(/\\s+/g, ' ').trim().slice(0, 700)
  let image = abs(meta('og:image') || meta('twitter:image'))
  if (!image) {
    const imgs = [...root.querySelectorAll('img')].filter((i) => i.naturalWidth >= 320 && i.naturalHeight >= 180)
    imgs.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
    if (imgs[0]) image = abs(imgs[0].currentSrc || imgs[0].src)
  }
  return {
    title: (meta('og:title') || document.title || '').slice(0, 200),
    site: (meta('og:site_name') || '').slice(0, 80),
    image: /^https?:/.test(image) ? image : '',
    text: text,
    app: paras.length < 2 && text.length < 200,
    pdf: document.contentType === 'application/pdf'
  }
})()`

/** The article as blocks: headings, paragraphs, quotes, list items and pictures, in order. */
const READER_SCRIPT = `(() => {
  const q = (s) => document.querySelector(s)
  const meta = (n) => { const m = q('meta[property="' + n + '"],meta[name="' + n + '"]'); return m ? (m.content || '').trim() : '' }
  const abs = (u) => { try { return new URL(u, location.href).href } catch (e) { return '' } }
  const root = q('article') || q('main') || document.body
  const blocks = []
  let size = 0
  for (const el of root.querySelectorAll('h1,h2,h3,h4,p,blockquote,li,img,figure img')) {
    if (size > 24000 || blocks.length > 400) break
    if (el.closest('nav,header,footer,aside,form,script,style,noscript,[role=navigation],[aria-hidden=true]')) continue
    const tag = el.tagName
    if (tag === 'IMG') {
      const src = abs(el.currentSrc || el.src)
      if (/^https?:/.test(src) && el.naturalWidth >= 240) blocks.push({ t: 'img', src: src, alt: (el.alt || '').slice(0, 160) })
      continue
    }
    const text = (el.innerText || '').replace(/\\s+/g, ' ').trim()
    if (text.length < (tag === 'LI' ? 12 : 3) || (tag === 'P' && text.length < 30)) continue
    size += text.length
    blocks.push({ t: tag[0] === 'H' ? 'h' : tag === 'BLOCKQUOTE' ? 'q' : tag === 'LI' ? 'li' : 'p', text: text.slice(0, 1600) })
  }
  return { title: (meta('og:title') || document.title || '').slice(0, 200), site: (meta('og:site_name') || '').slice(0, 80), blocks: blocks }
})()`

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))])

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

function cleanContent(raw: unknown): CanvasPageContent | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    title: str(r.title, 200),
    site: str(r.site, 80),
    image: /^https?:\/\//i.test(str(r.image, 1000)) ? str(r.image, 1000) : '',
    text: str(r.text, 700),
    app: r.app === true,
    pdf: r.pdf === true
  }
}

function cleanReader(raw: unknown): CanvasReaderDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.blocks)) return null
  const blocks: CanvasReaderBlock[] = []
  let size = 0
  for (const b of r.blocks) {
    if (!b || typeof b !== 'object' || blocks.length >= 400 || size > ITEM_TEXT_MAX * 6) break
    const o = b as Record<string, unknown>
    if (o.t === 'img' && /^https?:\/\//i.test(str(o.src, 1000))) {
      blocks.push({ t: 'img', src: str(o.src, 1000), alt: str(o.alt, 160) })
    } else if (o.t === 'h' || o.t === 'p' || o.t === 'q' || o.t === 'li') {
      const text = str(o.text, 1600)
      if (text) {
        size += text.length
        blocks.push({ t: o.t, text })
      }
    }
  }
  return { title: str(r.title, 200), site: str(r.site, 80), blocks }
}

/**
 * What the canvas reads for its cards: a page's own words (from the tab, or from a hidden page loaded for the
 * purpose and destroyed straight after), and the bytes of a PDF or picture. A private or Tor tab is never read.
 */
export class CanvasContent {
  private cards = new Map<string, CanvasPageContent>()

  constructor(private d: { tabs: TabManager; downloads: DownloadManager }) {}

  private remember(key: string, v: CanvasPageContent): void {
    this.cards.delete(key)
    this.cards.set(key, v)
    while (this.cards.size > CACHE_MAX) this.cards.delete(this.cards.keys().next().value as string)
  }

  /** The card text of an open tab's page. Null for a private or Tor tab, an unloaded one, or a page that will not say. */
  async card(tabId: number): Promise<CanvasPageContent | null> {
    const p = this.d.tabs.pageFor(tabId)
    if (!p || p.private || p.tor || p.unloaded || !/^https?:/i.test(p.url)) return null
    const key = `${p.url}\n${p.title}`
    const hit = this.cards.get(key)
    if (hit) return hit
    const got = cleanContent(await withTimeout(p.wc.executeJavaScript(CARD_SCRIPT), SCRIPT_MS))
    if (got) this.remember(key, got)
    return got
  }

  /** The article of an open tab, or of an address (loaded in a hidden page that is destroyed after). */
  async reader(req: { tab?: number; url?: string }): Promise<CanvasReaderDoc | null> {
    if (typeof req.tab === 'number') {
      const p = this.d.tabs.pageFor(req.tab)
      if (!p || p.private || p.tor || p.unloaded) return null
      return cleanReader(await withTimeout(p.wc.executeJavaScript(READER_SCRIPT), SCRIPT_MS * 2))
    }
    if (typeof req.url !== 'string' || !/^https?:\/\//i.test(req.url)) return null
    return this.hidden(req.url, (wc) => wc.executeJavaScript(READER_SCRIPT).then(cleanReader))
  }

  /**
   * Run something in a page nobody sees: sandboxed, no preload, the normal session, destroyed when it is done or
   * when it takes too long. At most one at a time per caller is the caller's business.
   */
  async hidden<T>(url: string, read: (wc: WebContents) => Promise<T | null>): Promise<T | null> {
    const win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 900,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        session: this.d.tabs.normalSession(),
        javascript: true,
        webSecurity: true
      }
    })
    const wc = win.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.setAudioMuted(true)
    try {
      const loaded = new Promise<void>((resolveLoad, reject) => {
        wc.once('did-finish-load', () => resolveLoad())
        wc.once('did-fail-load', (_e, code, desc) => reject(new Error(`${code} ${desc}`)))
      })
      void wc.loadURL(url).catch(() => undefined)
      const ok = await withTimeout(
        loaded.then(() => true),
        LOAD_MS
      )
      if (!ok) return null
      await new Promise((r) => setTimeout(r, 450)) // pages that draw their content a moment after they load
      return await withTimeout(read(wc), SCRIPT_MS * 2)
    } finally {
      if (!win.isDestroyed()) win.destroy()
    }
  }

  /** Where files dropped or pasted onto the board are kept (a copy, named by its content). */
  private storeDir(): string {
    return join(app.getPath('userData'), 'canvas-files')
  }

  /**
   * Keep a copy of a file dropped (a path from the person's own drag) or pasted (its bytes) onto the board, so its
   * card shows it after the original moves and without a network. Same content, same copy.
   */
  async store(req: {
    path?: string
    name?: string
    data?: Uint8Array
  }): Promise<{ file: string; name: string } | null> {
    try {
      let data: Uint8Array
      let name: string
      if (typeof req.path === 'string') {
        const st = await stat(req.path)
        if (!st.isFile() || st.size > BYTES_MAX) return null
        data = new Uint8Array(await readFile(req.path))
        name = basename(req.path)
      } else if (req.data instanceof Uint8Array && req.data.byteLength <= BYTES_MAX) {
        data = req.data
        name = typeof req.name === 'string' && req.name ? basename(req.name) : 'Pasted'
      } else return null
      const ext = extname(name).toLowerCase()
      const safe = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''
      const hash = createHash('sha256').update(data).digest('hex').slice(0, 24)
      const file = join(this.storeDir(), hash + safe)
      await mkdir(this.storeDir(), { recursive: true })
      await stat(file).catch(() => writeFile(file, data))
      return { file, name: name.slice(0, 200) }
    } catch {
      return null
    }
  }

  /** The files a card may read: downloads that finished, and the board's own copies. Anything else is refused. */
  private allowedFile(path: string): string | null {
    const want = resolve(path).toLowerCase()
    if (dirname(want) === resolve(this.storeDir()).toLowerCase()) return resolve(path)
    for (const d of this.d.downloads.list()) {
      if (d.state === 'completed' && resolve(d.savePath).toLowerCase() === want) return d.savePath
    }
    // a local file the person has open in a normal tab (a PDF opened from disk)
    for (const t of this.d.tabs.aiTabs()) {
      if (t.private || t.tor || !/^file:/i.test(t.url)) continue
      try {
        const p = fileURLToPath(t.url)
        if (resolve(p).toLowerCase() === want) return p
      } catch {
        // not a path
      }
    }
    return null
  }

  /** The bytes of a PDF or picture (a web address, or a finished download), for pdf.js and for local pictures. */
  async bytes(req: {
    url?: string
    file?: string
  }): Promise<{ mime: string; data: Uint8Array } | null> {
    try {
      if (typeof req.url === 'string') req = { ...req, url: pdfSource(req.url) }
      if (typeof req.url === 'string' && /^file:/i.test(req.url)) {
        try {
          req = { file: fileURLToPath(req.url) }
        } catch {
          return null
        }
      }
      if (typeof req.file === 'string') {
        const path = this.allowedFile(req.file)
        if (!path) return null
        const st = await stat(path)
        if (st.size > BYTES_MAX) return null
        const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
        const mime =
          ext === 'pdf'
            ? 'application/pdf'
            : ext === 'svg'
              ? 'image/svg+xml'
              : `image/${ext === 'jpg' ? 'jpeg' : ext || 'png'}`
        return { mime, data: new Uint8Array(await readFile(path)) }
      }
      if (typeof req.url !== 'string' || !/^https?:\/\//i.test(req.url)) return null
      const res = await this.d.tabs
        .normalSession()
        .fetch(req.url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) return null
      const len = Number(res.headers.get('content-length') ?? 0)
      if (len > BYTES_MAX) return null
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.byteLength > BYTES_MAX) return null
      return { mime: (res.headers.get('content-type') ?? '').split(';')[0], data: buf }
    } catch {
      return null
    }
  }
}
