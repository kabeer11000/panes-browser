import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Where a PDF comes from: the web, or a finished download (read through main, which checks the path). */
export interface PdfSrc {
  url?: string
  file?: string
}

const keyOf = (s: PdfSrc): string => s.file ?? s.url ?? ''

const DOCS_MAX = 3
const FIRST_MAX = 80
interface Opened {
  doc: Promise<PDFDocumentProxy | null>
  task: PDFDocumentLoadingTask | null
}
const docs = new Map<string, Opened>()
/** Documents a reader has open: never closed under it. */
const pins = new Map<string, number>()

function dropDoc(key: string): void {
  const gone = docs.get(key)
  docs.delete(key)
  void gone?.task?.destroy()
}

export function pinPdf(src: PdfSrc): void {
  pins.set(keyOf(src), (pins.get(keyOf(src)) ?? 0) + 1)
}

export function unpinPdf(src: PdfSrc): void {
  const key = keyOf(src)
  const n = (pins.get(key) ?? 1) - 1
  if (n <= 0) pins.delete(key)
  else pins.set(key, n)
}

/** Forget a document and its first page, open or not: the next open reads it again (a reload). */
export function reloadPdf(src: PdfSrc): void {
  const key = keyOf(src)
  dropDoc(key)
  firsts.delete(key)
}

/** A document, opened once and kept for a few at a time (the oldest are closed to give their memory back). */
export function openPdf(src: PdfSrc): Promise<PDFDocumentProxy | null> {
  const key = keyOf(src)
  if (!key) return Promise.resolve(null)
  const have = docs.get(key)
  if (have) {
    docs.delete(key)
    docs.set(key, have)
    return have.doc
  }
  const opened: Opened = { doc: Promise.resolve(null), task: null }
  opened.doc = window.api.canvas.bytes(src).then(async (r) => {
    if (!r) return null
    try {
      // a copy: pdf.js takes the buffer over, and the one it was given must not be reused
      opened.task = pdfjs.getDocument({ data: r.data.slice() })
      return await opened.task.promise
    } catch {
      return null
    }
  })
  // one that could not be read is not kept: the next open (a reload) tries again
  void opened.doc.then((d) => {
    if (!d && docs.get(key) === opened) docs.delete(key)
  })
  docs.set(key, opened)
  for (const k of [...docs.keys()]) {
    if (docs.size <= DOCS_MAX) break
    if (!pins.has(k) && k !== key) dropDoc(k)
  }
  return opened.doc
}

export interface FirstPage {
  /** A small picture of page one (an object address or data address). */
  src: string
  /** Width over height. */
  aspect: number
  pages: number
}

const firsts = new Map<string, FirstPage>()

/** Page one as a small picture, and how many pages there are. Cached; the picture is a JPEG, not a live canvas. */
export async function firstPage(src: PdfSrc, width = 240): Promise<FirstPage | null> {
  const key = keyOf(src)
  const hit = firsts.get(key)
  if (hit) return hit
  const doc = await openPdf(src)
  if (!doc) return null
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = (width * Math.min(2, window.devicePixelRatio || 1)) / base.width
    const viewport = page.getViewport({ scale })
    const c = document.createElement('canvas')
    c.width = Math.floor(viewport.width)
    c.height = Math.floor(viewport.height)
    await page.render({ canvas: c, viewport }).promise
    const out: FirstPage = {
      src: c.toDataURL('image/jpeg', 0.82),
      aspect: base.width / base.height,
      pages: doc.numPages
    }
    page.cleanup()
    c.width = c.height = 0 // give the pixels back at once
    firsts.set(key, out)
    if (!pins.has(key)) dropDoc(key) // the picture is all a card keeps; a reader opens the document again
    while (firsts.size > FIRST_MAX) firsts.delete(firsts.keys().next().value as string)
    return out
  } catch {
    return null
  }
}
