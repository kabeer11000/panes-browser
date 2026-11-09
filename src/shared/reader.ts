import { escapeHtml } from './print'

/**
 * Reader mode: the page's main text, as the print dialog's Simplify reads it (READER_SCRIPT in printCopy.ts), shown in
 * panes://reader in the same tab. The article is kept in memory in main under a random key, so the reader page can only
 * ask for the one it was opened with. Pure helpers here; main/reader.ts and internal/pages/Reader.tsx use them.
 */

export interface ReaderArticle {
  title: string
  url: string
  html: string
}

export type ReaderFont = 'serif' | 'sans'
export type ReaderWidth = 'narrow' | 'medium' | 'wide'
export type ReaderTheme = 'auto' | 'light' | 'sepia' | 'dark'

export interface ReaderPrefs {
  size: number
  font: ReaderFont
  width: ReaderWidth
  theme: ReaderTheme
}

export const READER_SIZE = { min: 14, max: 28, step: 1 } as const
export const DEFAULT_READER_PREFS: ReaderPrefs = {
  size: 19,
  font: 'serif',
  width: 'medium',
  theme: 'auto'
}
const FONTS: readonly ReaderFont[] = ['serif', 'sans']
const WIDTHS: readonly ReaderWidth[] = ['narrow', 'medium', 'wide']
const THEMES: readonly ReaderTheme[] = ['auto', 'light', 'sepia', 'dark']

/** Prefs read back from storage: anything unknown falls back to the default, the size is clamped. */
export function sanitizeReaderPrefs(raw: unknown): ReaderPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = <T>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d)
  const size =
    typeof r.size === 'number' && Number.isFinite(r.size)
      ? Math.min(READER_SIZE.max, Math.max(READER_SIZE.min, Math.round(r.size)))
      : DEFAULT_READER_PREFS.size
  return {
    size,
    font: pick(r.font, FONTS, DEFAULT_READER_PREFS.font),
    width: pick(r.width, WIDTHS, DEFAULT_READER_PREFS.width),
    theme: pick(r.theme, THEMES, DEFAULT_READER_PREFS.theme)
  }
}

// ---- addresses ----

const READER_ORIGIN = 'panes://reader/'

/** The reader page for an article kept under `key`; the source address rides along for the address bar. */
export const readerUrl = (source: string, key: string): string =>
  `${READER_ORIGIN}?u=${encodeURIComponent(source)}&k=${encodeURIComponent(key)}`

/** The page a reader address was made from, or null when `url` is not a reader page. */
export function readerSource(url: string): string | null {
  if (!url.startsWith(READER_ORIGIN)) return null
  try {
    const u = new URL(url).searchParams.get('u') ?? ''
    return /^https?:\/\//i.test(u) ? u : null
  } catch {
    return null
  }
}

/** The key in a reader address, or null. */
export function readerKey(url: string): string | null {
  if (!url.startsWith(READER_ORIGIN)) return null
  try {
    return new URL(url).searchParams.get('k') || null
  } catch {
    return null
  }
}

/** Pages reader mode can be opened on. */
export const canRead = (url: string): boolean => /^https?:\/\//i.test(url)

// ---- reading time ----

const WORDS_PER_MINUTE = 230

/** The words in an article's HTML (tags and entities dropped). */
export function wordCount(html: string): number {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#?\w+;/g, ' ')
    .trim()
  return text ? text.split(/\s+/).length : 0
}

/** Minutes to read, at least 1 for anything with words in it, 0 for nothing. */
export function readingMinutes(html: string): number {
  const n = wordCount(html)
  return n === 0 ? 0 : Math.max(1, Math.round(n / WORDS_PER_MINUTE))
}

// ---- the document shown in the sandboxed frame ----

const WIDTH_EM: Record<ReaderWidth, number> = { narrow: 30, medium: 38, wide: 48 }
const FONT_STACK: Record<ReaderFont, string> = {
  serif: "Charter, 'Iowan Old Style', Georgia, 'Times New Roman', serif",
  sans: "'Segoe UI Variable Text', 'SF Pro Text', Inter, system-ui, sans-serif"
}
const THEME_COLORS: Record<
  Exclude<ReaderTheme, 'auto'>,
  { bg: string; fg: string; dim: string; link: string; rule: string }
> = {
  light: { bg: '#ffffff', fg: '#1b1b1f', dim: '#5d5d66', link: '#0b57d0', rule: '#dcdce2' },
  sepia: { bg: '#f6efe2', fg: '#3b2f22', dim: '#6f604c', link: '#8a4b14', rule: '#e2d6c0' },
  dark: { bg: '#18181c', fg: '#e6e6ea', dim: '#a0a0aa', link: '#9db8ff', rule: '#33333b' }
}

/** The theme to draw, with `auto` following the page's light or dark scheme. */
export const resolvedTheme = (t: ReaderTheme, dark: boolean): Exclude<ReaderTheme, 'auto'> =>
  t === 'auto' ? (dark ? 'dark' : 'light') : t

/** Colours of a theme, for the toolbar around the frame to match it. */
export const themeColors = (t: Exclude<ReaderTheme, 'auto'>): (typeof THEME_COLORS)['light'] =>
  THEME_COLORS[t]

/** Style for the article, from the reader's choices. */
export function readerScreenCss(p: ReaderPrefs, dark: boolean): string {
  const c = THEME_COLORS[resolvedTheme(p.theme, dark)]
  return `
html{background:${c.bg};color-scheme:${resolvedTheme(p.theme, dark) === 'dark' ? 'dark' : 'light'}}
body{margin:0 auto;max-width:${WIDTH_EM[p.width]}em;padding:32px 24px 96px;color:${c.fg};background:${c.bg};font:${p.size}px/1.65 ${FONT_STACK[p.font]};overflow-wrap:break-word}
header{margin:0 0 2em;padding-bottom:1em;border-bottom:1px solid ${c.rule};font:13px/1.5 ${FONT_STACK.sans};color:${c.dim}}
header h1{margin:0 0 .4em;font:700 1.75em/1.2 ${FONT_STACK[p.font]};color:${c.fg}}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.5em 0 .5em}
p{margin:0 0 1em}
img{display:block;max-width:100%;height:auto;margin:1em auto;border-radius:8px}
figure{margin:1.2em 0}figcaption{font:13px/1.4 ${FONT_STACK.sans};color:${c.dim}}
blockquote{margin:1em 0;padding-left:1em;border-left:3px solid ${c.rule};color:${c.dim}}
pre{white-space:pre-wrap;font:.85em/1.5 Consolas,monospace;padding:.8em;border-radius:8px;background:${c.rule}55}
code{font-family:Consolas,monospace;font-size:.9em}
a{color:${c.link}}
hr{border:0;border-top:1px solid ${c.rule}}
table{border-collapse:collapse}td,th{border:1px solid ${c.rule};padding:.25em .5em}`
}

/**
 * The article as a document of its own, for an iframe with no script allowed. Links open in a new tab. The article's
 * HTML comes from the page and is only ever shown inside that sandbox.
 */
export function readerScreenDocument(
  a: ReaderArticle,
  p: ReaderPrefs,
  dark: boolean,
  meta: string
): string {
  const title = escapeHtml(a.title || a.url)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'">
<base target="_blank"><style>${readerScreenCss(p, dark)}</style></head><body>
<header>${/<h1[\s>]/i.test(a.html) ? '' : `<h1>${title}</h1>`}${escapeHtml(meta)}</header>
${a.html}
</body></html>`
}
