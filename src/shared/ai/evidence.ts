import { isGeneric, sanitize, splitExt } from './filenames'

/** Hard caps on every piece of evidence that reaches the prompt. */
export const CAPS = {
  title: 160,
  desc: 240,
  link: 100,
  hint: 160,
  fileText: 1200,
  meta: 160
}

export const FILE_READ_MAX = 50 * 1024 * 1024
export const TEXT_EXT = new Set([
  '.txt',
  '.csv',
  '.tsv',
  '.json',
  '.md',
  '.html',
  '.htm',
  '.xml',
  '.log'
])

export const FILENAME_SYSTEM = `You rename a downloaded file from the evidence given. Answer with JSON: {"name": "..."}.
Rules: 2 to 6 words, sentence case, no file extension, no folder. Keep the proper nouns, dates and IDs that matter.
Never use generic words such as file, document, download, final or copy. Leave out the site name unless it is the subject.
Write in the language of the content.
Examples:
- an invoice PDF titled "INV-2026-03 Acme Ltd" -> {"name": "Acme invoice 2026-03"}
- a rail pass PDF from a travel blog page "Japan Rail Pass: the full guide" -> {"name": "Kyoto rail pass guide"}
- slides whose title says "Q3 Board Update" -> {"name": "Q3 board deck"}`

export interface PageHints {
  ogTitle?: string
  h1?: string
  description?: string
  linkText?: string
}

export interface FilenameEvidence extends PageHints {
  filename: string
  url: string
  host: string
  mime?: string
  size?: number
  pageTitle?: string
  pageUrl?: string
  /** Title or subject from the file's own metadata. */
  fileTitle?: string
  /** The start of the file's readable text. */
  fileText?: string
}

const clip = (s: string | undefined, max: number): string =>
  (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

const NAME_PARAM = /^(file|filename|file_name|name|title|doc|document|download|attachment|f)$/i

/** What a download URL says about the file: its readable path segments and name-like query values, decoded. */
export function urlHints(url: string): { segments: string[]; params: string[] } {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { segments: [], params: [] }
  }
  const segments = u.pathname
    .split('/')
    .map((s) => decode(s).trim())
    .filter((s) => s.length > 1)
    .slice(-3)
    .map((s) => s.slice(0, CAPS.hint))
  const params: string[] = []
  for (const [k, v] of u.searchParams) {
    if (NAME_PARAM.test(k) && v.trim() && params.length < 3) {
      params.push(`${k}=${v.trim().slice(0, CAPS.hint)}`)
    }
  }
  return { segments, params }
}

/** The prompt: only what there is, every line capped. */
export function buildFilenamePrompt(e: FilenameEvidence): string {
  const hints = urlHints(e.url)
  const lines: Array<[string, string]> = [
    ['File name now', clip(e.filename, CAPS.hint)],
    ['Type', [e.mime, e.size ? `${Math.round(e.size / 1024)} KB` : ''].filter(Boolean).join(', ')],
    ['Link text', clip(e.linkText, CAPS.link)],
    ['Download URL path', hints.segments.join(' / ')],
    ['Download URL parameters', hints.params.join(', ')],
    ['Downloaded from', clip(e.host, 80)],
    ['Page title', clip(e.pageTitle, CAPS.title)],
    ['Page heading', clip(e.h1, CAPS.title)],
    ['Page og:title', clip(e.ogTitle, CAPS.title)],
    ['Page description', clip(e.description, CAPS.desc)],
    ['File metadata title', clip(e.fileTitle, CAPS.meta)]
  ]
  const out = lines.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)
  const text = clip(e.fileText, CAPS.fileText)
  if (text) out.push(`Start of the file:\n${text}`)
  return out.join('\n')
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * The model answer as a file name to offer, or null: unusable after clean-up, still generic, or the same as the
 * name it already has (ignoring case, spacing and punctuation).
 */
export function acceptSuggestion(raw: string | null, original: string): string | null {
  if (!raw) return null
  const { stem, ext } = splitExt(original)
  const name = sanitize(raw, ext)
  if (!name || isGeneric(name)) return null
  if (norm(splitExt(name).stem) === norm(stem)) return null
  return name
}

/** Page script: read once when a download starts. A fixed string; nothing a model says is ever run. */
export const PAGE_SCRIPT = `(() => {
  const meta = (s) => { const m = document.querySelector(s); return m ? String(m.content || "") : "" }
  const h = document.querySelector("h1")
  const hit = (el) => el && el.closest && el.closest("a,button,[role=button],[role=link]")
  const el = hit(document.activeElement) || hit(document.querySelector("a:hover,button:hover"))
  const link = el ? String(el.getAttribute("aria-label") || el.innerText || el.title || "") : ""
  return {
    ogTitle: meta("meta[property='og:title']").slice(0, 200),
    h1: String((h && h.innerText) || "").slice(0, 200),
    description: (meta("meta[name=description]") || meta("meta[property='og:description']")).slice(0, 300),
    linkText: link.replace(/\\s+/g, " ").trim().slice(0, 120)
  }
})()`

// ---- file contents (bytes in, short strings out; nothing is executed) ----

const latin1 = (b: Uint8Array): string => new TextDecoder('latin1').decode(b)

/** A PDF string body (without its brackets) as text: escapes, hex, UTF-16 with a byte order mark. */
function pdfString(raw: string, hex: boolean): string {
  let bytes: number[] = []
  if (hex) {
    const h = raw.replace(/[^0-9a-fA-F]/g, '')
    for (let i = 0; i + 1 < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16))
  } else {
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i)
      if (c !== 92) {
        bytes.push(c & 255)
        continue
      }
      const n = raw[++i] ?? ''
      if (/[0-7]/.test(n)) {
        let oct = n
        while (oct.length < 3 && /[0-7]/.test(raw[i + 1] ?? '')) oct += raw[++i]
        bytes.push(parseInt(oct, 8) & 255)
      } else if (n === 'n') bytes.push(10)
      else if (n === 'r') bytes.push(13)
      else if (n === 't') bytes.push(9)
      else if (n === 'b') bytes.push(8)
      else if (n === 'f') bytes.push(12)
      else if (n !== '\n' && n !== '\r') bytes.push(n.charCodeAt(0) & 255)
    }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    bytes = bytes.slice(2)
    let s = ''
    for (let i = 0; i + 1 < bytes.length; i += 2)
      s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    return s
  }
  return bytes.map((b) => String.fromCharCode(b)).join('')
}

/** One `/Key (value)` or `/Key <hex>` from PDF source text, decoded; undefined when absent. */
function pdfKey(src: string, key: string): string | undefined {
  const m = new RegExp(String.raw`/${key}\s*(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>)`).exec(src)
  if (!m) return undefined
  const v = m[1]
  const s = pdfString(v.slice(1, -1), v[0] === '<')
    .replace(/\p{Cc}/gu, ' ')
    .trim()
  return s || undefined
}

/**
 * Title and subject of a PDF, from the Info dictionary or, failing that, the XMP packet (PDF 1.5 files often keep
 * the Info dictionary inside a compressed object stream, which is not read here). Pass the head and tail of big files.
 */
export function pdfInfo(bytes: Uint8Array): { title?: string; subject?: string } {
  const src = latin1(bytes)
  let title = pdfKey(src, 'Title')
  let subject = pdfKey(src, 'Subject')
  if (!title) {
    const x = /<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]+)<\/rdf:li>/.exec(src)
    if (x) title = new TextDecoder('utf-8').decode(Uint8Array.from(x[1], (c) => c.charCodeAt(0)))
  }
  const junk = /^(untitled|microsoft word - .*|\S+\.(docx?|pdf|indd|tex))$/i
  if (title && junk.test(title)) title = undefined
  if (subject && junk.test(subject)) subject = undefined
  return { title: title?.slice(0, CAPS.meta), subject: subject?.slice(0, CAPS.meta) }
}

/**
 * The first readable text of a PDF: Tj/TJ strings in its content streams, inflating the compressed ones with the
 * caller's `inflate`. Fonts with custom encodings give garbage; that is dropped, so the result is often empty.
 */
export function pdfText(
  bytes: Uint8Array,
  inflate: (b: Uint8Array) => Uint8Array | null,
  max = CAPS.fileText
): string {
  const src = latin1(bytes)
  const re = /stream\r?\n/g
  let out = ''
  let m: RegExpExecArray | null
  let streams = 0
  while ((m = re.exec(src)) && out.length < max && streams < 40) {
    if (src.slice(m.index - 3, m.index) === 'end') continue
    const start = m.index + m[0].length
    const end = src.indexOf('endstream', start)
    if (end < 0) break
    streams++
    let body = bytes.subarray(start, end)
    const before = src.slice(Math.max(0, m.index - 300), m.index)
    if (/FlateDecode/.test(before.slice(before.lastIndexOf('<<')))) {
      const inflated = inflate(body)
      if (!inflated) continue
      body = inflated
    }
    const text = latin1(body)
    if (!/\bBT\b/.test(text)) continue
    for (const op of text.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      if (op[2] !== undefined) out += pdfString(op[2], false) + ' '
      else
        for (const s of op[1].matchAll(/\(((?:\\.|[^\\)])*)\)|(-?\d+(?:\.\d+)?)/g))
          out += s[1] !== undefined ? pdfString(s[1], false) : Number(s[2]) < -200 ? ' ' : ''
      if (out.length >= max) break
    }
  }
  out = out.replace(/\s+/g, ' ').trim()
  const letters = (out.match(/\p{L}/gu) ?? []).length
  return out.length >= 20 && letters / out.length > 0.6 ? out.slice(0, max) : ''
}

/** The start of a text-like file, tags and scripts of HTML dropped; empty for anything that looks binary. */
export function textSnippet(bytes: Uint8Array, ext: string, max = CAPS.fileText): string {
  if (!TEXT_EXT.has(ext.toLowerCase())) return ''
  let s = new TextDecoder('utf-8').decode(bytes.subarray(0, 8192))
  if (s.includes('\u0000') || (s.match(/�/g) ?? []).length > 3) return ''
  if (/^\.(html?|xml)$/i.test(ext)) {
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)
    s = s
      .replace(/<title[\s\S]*?<\/title>/i, ' ')
      .replace(/<(script|style)[\s\S]*?(<\/\1>|$)/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
    if (t) s = `${t[1]} ${s}`
  }
  return s.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Title / Description / Comment text chunks of a PNG. Other image types carry nothing read here. */
export function imageMeta(bytes: Uint8Array): string {
  const sig = [0x89, 0x50, 0x4e, 0x47]
  if (!sig.every((v, i) => bytes[i] === v)) return ''
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const found: string[] = []
  for (let p = 8; p + 12 <= bytes.length && found.length < 3;) {
    const len = dv.getUint32(p)
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8))
    if (type === 'IDAT' || type === 'IEND') break
    if (type === 'tEXt' && len < 4096) {
      const body = latin1(bytes.subarray(p + 8, p + 8 + len))
      const z = body.indexOf('\u0000')
      const key = body.slice(0, z)
      if (/^(Title|Description|Comment)$/i.test(key)) found.push(`${key}: ${body.slice(z + 1)}`)
    }
    p += 12 + len
  }
  return found.join('; ').slice(0, CAPS.meta * 2)
}
