/**
 * What a card on the canvas is: content, not a tab. Pure helpers (no Electron, no DOM) to tell a PDF from a picture
 * from a video from an ordinary page by its address or MIME type, and the data a card carries.
 */

export type ItemKind = 'pdf' | 'image' | 'page' | 'video' | 'answer'

/** How a thing is placed on the board: as text, as content shown inline, or as the real page. */
export type Placement = 'note' | 'document' | 'live'

export interface CanvasItem {
  kind: ItemKind
  /** The address it opens from (a web address, or a file: address for a download). */
  url: string
  title: string
  /** The site it is on, as shown ("example.com"). */
  site: string
  /** A hero picture, or a video's poster (an address). */
  image?: string
  /** The first lines of a page, or the whole text of an answer. */
  text?: string
  /** Width over height of a picture, once known. */
  aspect?: number
  /** Number of pages of a PDF, once read. */
  pages?: number
  /** Where it came from, for the little caption. */
  source?: 'tab' | 'history' | 'download' | 'web' | 'answer'
  /** A local file (a download): the path, only ever read through main. */
  file?: string
  /** The tab that shows this page, if there is one. */
  tab?: number
  /** How it was placed (by suggestion, or by the person). */
  placement?: Placement
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico'])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv'])
const VIDEO_HOSTS =
  /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv)$/i

const extOf = (path: string): string => {
  const name = path.split('/').pop() ?? ''
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** "www." and a trailing dot are not part of how a site is shown. */
export function siteOf(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'file:') return 'This computer'
    return u.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The YouTube video id in an address, or null. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const h = u.hostname.replace(/^(www\.|m\.)/, '')
    if (h === 'youtu.be')
      return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null
    if (h !== 'youtube.com') return null
    const v = u.searchParams.get('v')
    if (v && /^[\w-]{11}$/.test(v)) return v
    const m = /^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** A poster picture for a video address, where the site has a well-known one. */
export function posterFor(url: string): string | null {
  const id = youtubeId(url)
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
}

/**
 * The kind of content behind an address. A MIME type (from a download, or a response) wins; otherwise the file
 * extension of the path, then the well-known video sites. Everything else is an ordinary page.
 */
/**
 * The document a PDF viewer address shows: Chromium's viewer opens a PDF as
 * `chrome-extension://<viewer id>/<the PDF's own address>`. Any other address is returned as it is.
 */
export function pdfSource(url: string): string {
  const m = /^chrome-extension:\/\/[a-p]{32}\/((?:https?|file):\/\/?.+)$/i.exec(url)
  return m ? m[1] : url
}

export function kindOf(url: string, mime?: string | null): ItemKind {
  const m = (mime ?? '').toLowerCase().split(';')[0].trim()
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  try {
    const u = new URL(url)
    const ext = extOf(decodeURIComponent(u.pathname))
    if (ext === 'pdf') return 'pdf'
    if (IMAGE_EXT.has(ext)) return 'image'
    if (VIDEO_EXT.has(ext)) return 'video'
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      if (VIDEO_HOSTS.test(u.hostname) && (youtubeId(url) || /vimeo\.com\/\d+/.test(url)))
        return 'video'
    }
  } catch {
    // not an address: an ordinary page for want of anything better
  }
  return 'page'
}

/** The text of a page cut to a few lines for a card, at a word boundary. */
export function excerpt(text: string, max = 260): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '...'
}

/** A card from what is known of an address: the kind, the site, a poster if there is one. */
export function itemFor(
  url: string,
  title: string,
  extra: Partial<CanvasItem> & { mime?: string | null } = {}
): CanvasItem {
  const { mime, ...rest } = extra
  const kind = rest.kind ?? kindOf(url, mime)
  return {
    kind,
    url,
    title: title.trim() || siteOf(url) || url,
    site: siteOf(url),
    image: kind === 'video' ? (posterFor(url) ?? undefined) : kind === 'image' ? url : undefined,
    ...rest
  }
}

/** What an item is called, for a label and an accessible name. */
export const KIND_LABEL: Record<ItemKind, string> = {
  pdf: 'PDF',
  image: 'Image',
  page: 'Page',
  video: 'Video',
  answer: 'Answer'
}

/** Whether a card of this kind can open as a live page (the real browser view). */
export const canOpenLive = (item: CanvasItem): boolean =>
  item.kind === 'page' || item.kind === 'video'

/** The most text an item is kept with on disk and in memory. */
export const ITEM_TEXT_MAX = 6000

/** A copy of an item that is safe to keep: text cut, no local path leaving the board's own state for private use. */
export function keepItem(item: CanvasItem): CanvasItem {
  return { ...item, text: item.text ? item.text.slice(0, ITEM_TEXT_MAX) : undefined }
}

// ---- what main reads from pages for the cards ----

/** What a page says about itself, for its card. */
export interface CanvasPageContent {
  title: string
  site: string
  image: string
  text: string
  /** Few paragraphs: an app, not a document. The card shows the snapshot instead. */
  app: boolean
  /** The tab shows a PDF (Chromium's viewer) whatever its address says. */
  pdf?: boolean
}

export type CanvasReaderBlock =
  { t: 'h' | 'p' | 'q' | 'li'; text: string } | { t: 'img'; src: string; alt: string }

export interface CanvasReaderDoc {
  title: string
  site: string
  blocks: CanvasReaderBlock[]
}
