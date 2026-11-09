import { cleanTitle } from './ai/titles'
import { sanitize } from './ai/filenames'

export type PaperId = 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5' | 'Tabloid'
export type MarginKind = 'default' | 'none' | 'minimum' | 'custom'

export const PAPER_IDS: PaperId[] = ['A4', 'Letter', 'Legal', 'A3', 'A5', 'Tabloid']
export const MARGIN_MM = { default: 10, minimum: 4, none: 0 } as const
export const CUSTOM_MARGIN_MAX_MM = 50
export const SCALE_MIN = 10
export const SCALE_MAX = 200
export const COPIES_MAX = 99

/** Destination value for "Save as PDF"; anything else is a printer's system name. */
export const PDF_DESTINATION = 'pdf'

export interface PrintOptions {
  destination: string
  /** All pages, or only the ranges in `pages` ("1-3, 5"). */
  allPages: boolean
  pages: string
  copies: number
  landscape: boolean
  color: boolean
  paper: PaperId
  margins: MarginKind
  /** Millimetres on every side, used when margins is 'custom'. */
  customMarginMm: number
  /** Percent; 100 is the page as it is. */
  scale: number
  headerFooter: boolean
  background: boolean
  /** Print the readable text of the page (title, text, pictures) in clean type instead of the page as it is. */
  simplify: boolean
  noImages: boolean
  lightBackground: boolean
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  destination: PDF_DESTINATION,
  allPages: true,
  pages: '',
  copies: 1,
  landscape: false,
  color: true,
  paper: 'A4',
  margins: 'default',
  customMarginMm: 10,
  scale: 100,
  headerFooter: true,
  background: false,
  simplify: false,
  noImages: false,
  lightBackground: false
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number.NaN
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback
}
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T =>
  all.includes(v as T) ? (v as T) : fallback

/** Options from anywhere untrusted (IPC, a file on disk): each field checked, anything off replaced from `base`. */
export function normalizeOptions(
  raw: unknown,
  base: PrintOptions = DEFAULT_PRINT_OPTIONS
): PrintOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    destination:
      typeof r.destination === 'string' && r.destination && r.destination.length < 300
        ? r.destination
        : base.destination,
    allPages: bool(r.allPages, base.allPages),
    pages: typeof r.pages === 'string' ? r.pages.slice(0, 200) : base.pages,
    copies: clampInt(r.copies, 1, COPIES_MAX, base.copies),
    landscape: bool(r.landscape, base.landscape),
    color: bool(r.color, base.color),
    paper: oneOf(r.paper, PAPER_IDS, base.paper),
    margins: oneOf(r.margins, ['default', 'none', 'minimum', 'custom'], base.margins),
    customMarginMm: clampInt(r.customMarginMm, 0, CUSTOM_MARGIN_MAX_MM, base.customMarginMm),
    scale: clampInt(r.scale, SCALE_MIN, SCALE_MAX, base.scale),
    headerFooter: bool(r.headerFooter, base.headerFooter),
    background: bool(r.background, base.background),
    simplify: bool(r.simplify, base.simplify),
    noImages: bool(r.noImages, base.noImages),
    lightBackground: bool(r.lightBackground, base.lightBackground)
  }
}

/** What is kept between prints: everything but which pages and how many copies (those belong to one job). */
export function remembered(o: PrintOptions): Partial<PrintOptions> {
  const rest: Partial<PrintOptions> = { ...o }
  delete rest.allPages
  delete rest.pages
  delete rest.copies
  return rest
}

// ---- page ranges ----

export interface PageRange {
  from: number
  to: number
}
export type RangeResult = { ok: true; ranges: PageRange[] } | { ok: false; error: string }

/**
 * "1-3, 5, 8-" as sorted, merged 1-based ranges; empty text is no ranges. With `total` known a range running past
 * the end is cut there and one starting past it is an error. Reversed ranges, zero and stray text are errors with
 * a message fit to show.
 */
export function parsePageRanges(text: string, total?: number): RangeResult {
  const src = text.trim()
  if (src === '') return { ok: true, ranges: [] }
  const out: PageRange[] = []
  for (const raw of src.split(',')) {
    const part = raw.replace(/\s+/g, '')
    if (part === '') return { ok: false, error: 'Remove the extra comma' }
    const m = /^(\d+)(?:(-)(\d*))?$/.exec(part)
    if (!m) return { ok: false, error: `"${raw.trim()}" is not a page or range` }
    const from = Number(m[1])
    const to = m[2] ? (m[3] === '' ? (total ?? Infinity) : Number(m[3])) : from
    if (from < 1) return { ok: false, error: 'Pages start at 1' }
    if (to < from) return { ok: false, error: `${from}-${to} runs backwards` }
    if (total !== undefined && from > total)
      return { ok: false, error: `The page has ${total} ${total === 1 ? 'page' : 'pages'}` }
    out.push({ from, to: total !== undefined ? Math.min(to, total) : to })
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to)
  const merged: PageRange[] = []
  for (const r of out) {
    const last = merged[merged.length - 1]
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to)
    else merged.push({ ...r })
  }
  return { ok: true, ranges: merged }
}

/** "1-3, 5". */
export const formatRanges = (ranges: PageRange[]): string =>
  ranges
    .map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to === Infinity ? '' : r.to}`))
    .join(', ')

/** The ranges the options ask for ([] is every page). */
export function resolvePages(o: PrintOptions, total?: number): RangeResult {
  return o.allPages ? { ok: true, ranges: [] } : parsePageRanges(o.pages, total)
}

// ---- Electron options ----

export const marginMm = (o: PrintOptions): number =>
  o.margins === 'custom' ? o.customMarginMm : MARGIN_MM[o.margins]

const inches = (mm: number): number => mm / 25.4

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const EDGE =
  'font:8px Arial,sans-serif;color:#444;width:100%;padding:0 0.4in;display:flex;justify-content:space-between'

/**
 * Chromium's own header and footer (date and title above, address and page number below), written out so a
 * simplified copy shows the real page's title and address instead of the temporary file it was printed from.
 */
export function edgeTemplates(
  page: { title: string; url: string },
  date: string
): {
  headerTemplate: string
  footerTemplate: string
} {
  return {
    headerTemplate: `<div style="${EDGE}"><span>${escapeHtml(date)}</span><span>${escapeHtml(page.title)}</span><span></span></div>`,
    footerTemplate: `<div style="${EDGE}"><span>${escapeHtml(page.url)}</span><span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`
  }
}

export interface PdfOptions {
  landscape: boolean
  displayHeaderFooter: boolean
  printBackground: boolean
  scale: number
  pageSize: PaperId
  margins: { top: number; bottom: number; left: number; right: number }
  pageRanges: string
  headerTemplate?: string
  footerTemplate?: string
}

export interface PrinterOptions {
  silent: true
  deviceName: string
  color: boolean
  landscape: boolean
  copies: number
  collate: boolean
  printBackground: boolean
  scaleFactor: number
  pageSize: PaperId
  margins: { marginType: 'custom'; top: number; bottom: number; left: number; right: number }
  pageRanges?: Array<{ from: number; to: number }>
  header?: string
  footer?: string
}

/** For webContents.printToPDF (margins in inches). */
export function toPdfOptions(
  o: PrintOptions,
  ranges: PageRange[],
  /** The real page, when printing from a copy of it: its title and address go in the header and footer. */
  page?: { title: string; url: string; date: string }
): PdfOptions {
  const m = inches(marginMm(o))
  return {
    ...(page && o.headerFooter ? edgeTemplates(page, page.date) : {}),
    landscape: o.landscape,
    displayHeaderFooter: o.headerFooter,
    printBackground: o.background,
    scale: o.scale / 100,
    pageSize: o.paper,
    margins: { top: m, bottom: m, left: m, right: m },
    pageRanges: formatRanges(ranges)
  }
}

/** For webContents.print on a printer. Page ranges are 0-based there; `total` caps an open end. */
export function toPrinterOptions(
  o: PrintOptions,
  ranges: PageRange[],
  total: number
): PrinterOptions {
  const pt = Math.round(inches(marginMm(o)) * 72) // custom margins are in points
  return {
    silent: true as const,
    deviceName: o.destination,
    color: o.color,
    landscape: o.landscape,
    copies: o.copies,
    collate: true,
    printBackground: o.background,
    scaleFactor: o.scale,
    pageSize: o.paper,
    margins: { marginType: 'custom' as const, top: pt, bottom: pt, left: pt, right: pt },
    ...(ranges.length
      ? { pageRanges: ranges.map((r) => ({ from: r.from - 1, to: Math.min(r.to, total) - 1 })) }
      : {}),
    // an empty header and footer ask for Chromium's own (title, address, date, page number)
    ...(o.headerFooter ? { header: '', footer: '' } : {})
  }
}

/** Pages in a PDF, counted from its page objects (Skia writes them in plain text); 0 when none are found. */
export function countPdfPages(bytes: Uint8Array): number {
  let s = ''
  for (let i = 0; i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return (s.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length
}

/** "<tidied title>.pdf", the site's name when there is no title, "page.pdf" when there is nothing at all. */
export function pdfFileName(title: string, url: string): string {
  let host = ''
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    // no site name
  }
  return sanitize(cleanTitle(title, url).title, '.pdf') ?? sanitize(host, '.pdf') ?? 'page.pdf'
}
