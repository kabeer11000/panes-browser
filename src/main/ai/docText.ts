import { readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'
import { docKind, type DocKind } from '@shared/ai/docs'

/**
 * The words in a document, for the chat: a PDF through pdf.js (no worker, no fonts, no eval: text only), a text
 * file as it is. Images and other binaries are refused. Everything is cut to a cap the caller gives.
 */

export const FILE_MAX = 40 * 1024 * 1024
const PAGES_MAX = 400

export interface DocText {
  name: string
  kind: DocKind
  text: string
  /** PDF pages; 0 for a text file. */
  pages: number
  /** The text was cut at the cap. */
  cut: boolean
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjs: Promise<PdfJs> | null = null
const loadPdfJs = (): Promise<PdfJs> => (pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs'))

/** The text of a PDF, page by page, up to `cap` characters. Null when it is not a PDF pdf.js can open. */
export async function pdfText(
  data: Uint8Array,
  cap: number
): Promise<{ text: string; pages: number; cut: boolean } | null> {
  const lib = await loadPdfJs()
  const task = lib.getDocument({
    data: data.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0
  })
  try {
    const doc = await task.promise
    const out: string[] = []
    let len = 0
    let cut = false
    const n = Math.min(doc.numPages, PAGES_MAX)
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      let line = ''
      for (const it of tc.items) {
        if (!('str' in it)) continue
        line += it.str
        if (it.hasEOL) line += '\n'
        else if (it.str && !it.str.endsWith(' ')) line += ' '
      }
      page.cleanup()
      const body = line
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      const chunk = `[page ${i}]\n${body}\n`
      if (len + chunk.length > cap) {
        out.push(chunk.slice(0, Math.max(0, cap - len)))
        cut = true
        break
      }
      out.push(chunk)
      len += chunk.length
    }
    if (doc.numPages > n) cut = true
    return { text: out.join('\n').trim(), pages: doc.numPages, cut }
  } catch {
    return null
  } finally {
    void task.destroy()
  }
}

/** A file from disk the person chose: its text, or null when it is too big, not readable, or not a document. */
export async function fileText(path: string, cap: number): Promise<DocText | null> {
  const name = basename(path)
  const kind = docKind(name)
  if (!kind) return null
  try {
    const st = await stat(path)
    if (!st.isFile() || st.size > FILE_MAX) return null
    const data = new Uint8Array(await readFile(path))
    return bytesText(name, data, cap, kind)
  } catch {
    return null
  }
}

/** Bytes already in hand (a download, a PDF tab): their text. */
export async function bytesText(
  name: string,
  data: Uint8Array,
  cap: number,
  kind: DocKind | null = docKind(name)
): Promise<DocText | null> {
  const isPdf = kind === 'pdf' || (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44)
  if (isPdf) {
    const r = await pdfText(data, cap)
    return r ? { name, kind: 'pdf', ...r } : null
  }
  if (kind !== 'text') return null
  // a text file: refuse what is clearly binary
  const head = data.subarray(0, 4096)
  if (head.includes(0)) return null
  const full = new TextDecoder('utf-8', { fatal: false }).decode(data)
  return { name, kind: 'text', text: full.slice(0, cap), pages: 0, cut: full.length > cap }
}

export const extOf = (name: string): string => extname(name).slice(1).toLowerCase()
