import { Img } from './Img'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { parseMarkdown, type Block, type Inline } from '@shared/ai/markdown'
import type { CanvasReaderDoc } from '@shared/ai/canvasItems'
import type { PageMenuPick, PreviewSwipe, Rect, TabInfo } from '@shared/types'
import type { Grouped } from '@shared/attention'
import { pageCaps, restRect, zoomPercent } from '@shared/ai/previewBar'
import type { CardModel } from './model'
import { READER } from './model'
import { LiveIcon, UnsplitIcon } from './icons'
import {
  BackIcon,
  ChevronDownIcon,
  ForwardIcon,
  MoreIcon,
  ReloadIcon,
  SpeakerIcon,
  StopIcon
} from '@renderer/components/icons'
import { FindBar } from '@renderer/components/FindBar'
import { getSlide, getSlideY } from '@renderer/slide'
import { openPdf, pinPdf, reloadPdf, unpinPdf } from './pdf'
import { anchorOver, askSearch } from './askSearch'
import { PreviewInbox } from './PreviewInbox'
import { EdgeSwipe, SWIPE_ZONES } from '@shared/edgeSwipe'
import { Spring, reducedMotion } from '@renderer/motion'
import './preview.css'

/**
 * The flight between a card and its preview, in the panel's own (untransformed) units: at 0 the panel is scaled by
 * `s` (uniformly: nothing in it stretches) and moved by (tx, ty), clipped by the insets t/r/b/l to just the card's
 * picture; at 1 it is at rest. `r0`: the card's corner radius on screen; `fade`: how far in it is fully opaque.
 */
interface Flight {
  s: number
  tx: number
  ty: number
  t: number
  r: number
  b: number
  l: number
  pw: number
  ph: number
  r0: number
  fade: number
}

/**
 * The card on the board now, relative to the preview's root (screen px, so the board's zoom is in it): its face (the
 * flight's start and end, with its corner radius) and its picture inside, if it shows one (what the flight's page
 * picture is lined up with).
 */
function cardTarget(
  id: number,
  root: HTMLElement
): {
  box: { x: number; y: number; w: number; h: number }
  radius: number
  img: HTMLImageElement | null
  imgBox: { w: number; h: number } | null
} | null {
  const card = document.querySelector<HTMLElement>(`.cv-card[data-cid="${id}"]`)
  if (!card) return null
  const face =
    card.querySelector<HTMLElement>(
      ':scope > :is(.cv-snap, .cv-video, .cv-image, .cv-doc, .cv-answer, .cv-pdf)'
    ) ?? card
  const b = face.getBoundingClientRect()
  if (b.width < 4 || b.height < 4) return null
  const img = face.querySelector<HTMLImageElement>(':scope > img, .cv-image-in > img')
  const ib = img?.getBoundingClientRect()
  const rr = root.getBoundingClientRect()
  const zoom = face.offsetWidth ? b.width / face.offsetWidth : 1
  const radius = (parseFloat(getComputedStyle(face).borderTopLeftRadius) || 14) * zoom
  return {
    box: { x: b.x - rr.x, y: b.y - rr.y, w: b.width, h: b.height },
    radius,
    img: ib && ib.width > 4 ? img! : null,
    imgBox: ib && ib.width > 4 ? { w: ib.width, h: ib.height } : null
  }
}

/**
 * A site's icon in the header, decoded with the frame it first shows in: the header is made anew when another card
 * takes the preview's place, and an icon decoded a frame late would blink.
 */
function HeadIcon({ m }: { m: Pick<CardModel, 'favicon' | 'site' | 'title'> }): React.JSX.Element {
  const [bad, setBad] = useState<string | null>(null)
  // a page with no name yet (still loading, or only a download) shows an empty mark, not a question mark
  const letter = <span>{(m.site || m.title).charAt(0).toUpperCase()}</span>
  if (!m.favicon || bad === m.favicon) return letter
  const src = m.favicon
  return <img src={src} alt="" decoding="sync" draggable={false} onError={() => setBad(src)} />
}

/** Hide or show a card under the preview straight away, ahead of the board's own state (see Expanded's close). */
function coverCard(id: number, hidden: boolean): void {
  document.querySelector(`.cv-card[data-cid="${id}"]`)?.classList.toggle('away', hidden)
}

/** A promise with its resolve, and whether it has. */
function deferred(): { promise: Promise<void>; resolve: () => void; done: boolean } {
  let resolve = (): void => undefined
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve, done: false }
}

// Another card's preview put in place of this one (Canvas mounts a new one): the page live in it stays on screen
// until the next one's page is ready to take its place, so the hide waits a tick for the next preview to take over.
let hideTimer = 0
function hideLiveSoon(): void {
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => window.api.canvas.liveHide(), 0)
}
function keepLive(): void {
  window.clearTimeout(hideTimer)
}
/** The recent tabs' pill of the preview just replaced, as it was gliding: the next one carries on from there. */
let pillNow: { x: number; v: number; t: number } | null = null
/** Room kept under the panel for the canvas toolbar, which stays above it. */
/** PDF pages stop growing here: wider than this they read worse, and Ctrl+wheel zooms past it. */
const PDF_W = 940
/**
 * Panes' own PDF reader (pdf.js) in the preview. Off for now: a PDF opens live in the browser's own viewer, as in
 * tab view; pdf.js only draws the first page as the card's picture. Set true to bring the reader back.
 */
const OWN_PDF_VIEWER = false
const ownPdf = (kind: string): boolean => OWN_PDF_VIEWER && kind === 'pdf'

export interface ExpandSource {
  m: CardModel
  /** Where the card is on screen (relative to the board's root), for the morph. */
  from: { x: number; y: number; w: number; h: number }
  tab?: number
  url?: string
  file?: string
}

interface Props extends ExpandSource {
  stage: { w: number; h: number }
  reduced: boolean
  answerLinks: (text: string) => void
  /** Where the card is on screen now (it may have moved since: the board glided to it), for the morph back. */
  cardBox?: () => { x: number; y: number; w: number; h: number } | null
  onClose: () => void
  /** The panel now covers its card (true, once it has grown) or is about to uncover it (false, as it closes). */
  onCover?: (covered: boolean) => void
  onGoToTab: () => void
  /** A tab was made for the live page: the card should remember it. */
  onTab: (tab: number) => void
  /** The text of a note was edited. */
  onText?: (text: string) => void
  /** The previous or next card of the same section (arrow keys). */
  onStep?: (dir: -1 | 1) => void
  /** Open straight onto the live page (something the assistant just opened, or a page last looked at live). */
  startLive?: boolean
  /** The person switched between the live page and its words (remembered for the next time it opens). */
  onLive?: (url: string, live: boolean) => void
  /** Open the conversation about this page (the board's Ask handle is under the preview). */
  onAsk?: () => void
  /**
   * The card is in a split view: every tab of the split in order (this card's among them), with its picture. Live,
   * they show side by side; the bar acts on this card's page.
   */
  split?: Array<{ tab: number; snap?: string }>
  /** The card's tab as the browser knows it (address, loading, history, bookmark, sound), when it has one. */
  page?: TabInfo
  /** The preview's recent tabs, this one among them, in an order kept while the preview is open. */
  recent?: CardModel[]
  /** Put another card in this preview, in place (one of `recent`). */
  onSwitch?: (id: number) => void
  /** It replaced another card's preview in place: no opening flight, the page fades in where the last one was. */
  swapped?: boolean
  /** The card it replaced, where the recent tabs' highlight slides from. */
  swapFrom?: number
  /** What waits in the tabs (messages, calls), one entry per site or account, for the header's bell. */
  waiting?: Grouped<TabInfo>[]
  /** Open another tab in the preview (picked from the bell). */
  onOpenTab?: (tab: number) => void
  /** The touchpad swipe that closes it (Settings): off, from the very edge, or easier. */
  swipe?: PreviewSwipe
}

// ---- answer text ----

function Inlines({
  nodes,
  onLink
}: {
  nodes: Inline[]
  onLink: (href: string) => void
}): React.JSX.Element {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.t === 'text') return n.text
        if (n.t === 'code') return <code key={i}>{n.text}</code>
        if (n.t === 'strong')
          return (
            <strong key={i}>
              <Inlines nodes={n.children} onLink={onLink} />
            </strong>
          )
        if (n.t === 'em')
          return (
            <em key={i}>
              <Inlines nodes={n.children} onLink={onLink} />
            </em>
          )
        return (
          <a
            key={i}
            href={n.href}
            title={n.href}
            onClick={(e) => {
              e.preventDefault()
              onLink(n.href)
            }}
          >
            <Inlines nodes={n.children} onLink={onLink} />
          </a>
        )
      })}
    </>
  )
}

function BlockView({ b, onLink }: { b: Block; onLink: (href: string) => void }): React.JSX.Element {
  switch (b.t) {
    case 'p':
      return (
        <p>
          <Inlines nodes={b.children} onLink={onLink} />
        </p>
      )
    case 'h':
      return (
        <h4>
          <Inlines nodes={b.children} onLink={onLink} />
        </h4>
      )
    case 'quote':
      return (
        <blockquote>
          <Inlines nodes={b.children} onLink={onLink} />
        </blockquote>
      )
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul'
      return (
        <L>
          {b.items.map((it, i) => (
            <li key={i}>
              <Inlines nodes={it} onLink={onLink} />
            </li>
          ))}
        </L>
      )
    }
    case 'code':
      return (
        <pre>
          <code>{b.text}</code>
        </pre>
      )
  }
}

/** A note: its Markdown as it reads, and a way to edit it (kept as the person types). */
function NoteBody({
  text,
  onText,
  onLink
}: {
  text: string
  onText: (t: string) => void
  onLink: (href: string) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <button type="button" className="cv-pill small" onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {editing ? (
        <textarea
          className="cv-note-edit"
          style={{ minHeight: 280 }}
          defaultValue={text}
          maxLength={6000}
          aria-label="Note text"
          autoFocus
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => onText(e.currentTarget.value)}
        />
      ) : (
        <AnswerText text={text} onLink={onLink} />
      )}
    </>
  )
}

/** An answer in Markdown as elements: links open as cards on the board, never as navigation. */
export const AnswerText = memo(function AnswerText({
  text,
  onLink
}: {
  text: string
  onLink: (href: string) => void
}): React.JSX.Element {
  return (
    <div className="cv-md">
      {parseMarkdown(text).map((b, i) => (
        <BlockView key={i} b={b} onLink={onLink} />
      ))}
    </div>
  )
})

const Glyph = ({ d }: { d: string }): React.JSX.Element => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
)
const LinkGlyph = (): React.JSX.Element => (
  <Glyph d="M6.6 9.4 9.4 6.6M7.2 4.6l1-1a2.6 2.6 0 0 1 3.7 3.7l-1 1M8.8 11.4l-1 1a2.6 2.6 0 0 1-3.7-3.7l1-1" />
)
const CheckGlyph = (): React.JSX.Element => <Glyph d="m3.4 8.4 3 3 6.2-6.6" />
/** Open outside the board: the usual arrow leaving a box. */
const PopOutGlyph = (): React.JSX.Element => (
  <Glyph d="M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5V12a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 3 12V5.5A1.5 1.5 0 0 1 4.5 4H7" />
)

// ---- reader view ----

/** A card's kept text as a document to read: one paragraph per blank-line block. */
function storedDoc(text: string | undefined): CanvasReaderDoc | null {
  const blocks = (text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ t: 'p' as const, text: p }))
  return blocks.length ? { title: '', site: '', blocks } : null
}

function ReaderView({
  tab,
  url,
  stored,
  onEmpty
}: {
  tab?: number
  url?: string
  /** The text kept with the card when it was put on the board: read from it when the page cannot be reached. */
  stored?: string
  onEmpty: () => void
}): React.JSX.Element {
  const [doc, setDoc] = useState<CanvasReaderDoc | null | 'loading'>('loading')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let dead = false
    const kept = storedDoc(stored)
    // offline: straight to the saved copy, no wait for a load that cannot work
    const read = navigator.onLine ? window.api.canvas.reader({ tab, url }) : Promise.resolve(null)
    void read.then((d) => {
      if (dead) return
      const use = d ?? kept
      setSaved(!d && !!kept)
      setDoc(use)
      if (!use || use.blocks.filter((b) => b.t === 'p').length < 2) onEmpty()
    })
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, url])
  if (doc === 'loading') {
    return (
      <div className="cv-reader loading" aria-busy="true">
        <div className="cv-shimmer line w60" />
        <div className="cv-shimmer line" />
        <div className="cv-shimmer line" />
        <div className="cv-shimmer line w80" />
      </div>
    )
  }
  if (!doc)
    return (
      <p className="cv-note-empty pad">
        This page has no article to show. Open it live to see it as it is.
      </p>
    )
  return (
    <article className="cv-reader">
      {saved && <p className="cv-saved">Saved copy. The page could not be reached.</p>}
      {doc.blocks.map((b, i) =>
        b.t === 'img' ? (
          <img key={i} src={b.src} alt={b.alt} loading="lazy" decoding="async" draggable={false} />
        ) : b.t === 'h' ? (
          <h4 key={i}>{b.text}</h4>
        ) : b.t === 'q' ? (
          <blockquote key={i}>{b.text}</blockquote>
        ) : b.t === 'li' ? (
          <p key={i} className="li">
            {b.text}
          </p>
        ) : (
          <p key={i}>{b.text}</p>
        )
      )}
    </article>
  )
}

// ---- picture viewer ----

function ImageViewer({ src }: { src: string }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const view = useRef({ x: 0, y: 0, k: 1 })
  const apply = (): void => {
    const v = view.current
    if (img.current)
      img.current.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.k})`
  }
  useEffect(() => {
    const el = box.current
    if (!el) return
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const r = el.getBoundingClientRect()
      const cx = e.clientX - r.left - r.width / 2
      const cy = e.clientY - r.top - r.height / 2
      const v = view.current
      const k = Math.min(
        8,
        Math.max(1, v.k * Math.exp(-Math.max(-40, Math.min(40, e.deltaY)) * 0.0095))
      )
      const f = k / v.k
      view.current =
        k === 1 ? { x: 0, y: 0, k } : { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f }
      apply()
    }
    let drag: { x: number; y: number } | null = null
    const down = (e: PointerEvent): void => {
      if (view.current.k === 1) return
      drag = { x: e.clientX, y: e.clientY }
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent): void => {
      if (!drag) return
      view.current.x += e.clientX - drag.x
      view.current.y += e.clientY - drag.y
      drag = { x: e.clientX, y: e.clientY }
      apply()
    }
    const up = (): void => {
      drag = null
    }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
  }, [])
  return (
    <div
      className="cv-viewer"
      ref={box}
      onDoubleClick={() => {
        view.current = view.current.k === 1 ? { x: 0, y: 0, k: 2.5 } : { x: 0, y: 0, k: 1 }
        apply()
      }}
    >
      <img ref={img} src={src} alt="" decoding="async" draggable={false} />
      <span className="cv-viewer-hint">Scroll to zoom, double-click for 250%</span>
    </div>
  )
}

// ---- PDF reader ----

function PdfPage({
  doc,
  num,
  width,
  root,
  aspect
}: {
  doc: PDFDocumentProxy
  num: number
  width: number
  root: HTMLElement | null
  aspect: number
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(num <= 2)
  const [own, setOwn] = useState(aspect)
  useEffect(() => {
    if (!root || !box.current) return
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), {
      root,
      rootMargin: '700px 0px'
    })
    io.observe(box.current)
    return () => io.disconnect()
  }, [root])
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    if (!near) {
      c.width = c.height = 0 // a page far from the reader gives its pixels back
      return
    }
    let dead = false
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    void doc.getPage(num).then(
      (page) => {
        if (dead) return
        const base = page.getViewport({ scale: 1 })
        setOwn(base.width / base.height)
        const viewport = page.getViewport({
          scale: (width / base.width) * Math.min(2, window.devicePixelRatio || 1)
        })
        c.width = Math.floor(viewport.width)
        c.height = Math.floor(viewport.height)
        task = page.render({ canvas: c, viewport })
        task.promise.catch(() => undefined)
      },
      () => undefined
    )
    return () => {
      dead = true
      task?.cancel()
    }
  }, [doc, num, near, width])
  return (
    <div className="cv-pg" ref={box} style={{ width, height: width / own }} data-page={num}>
      <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

function PdfReader({
  src,
  width,
  reloadKey = 0
}: {
  src: { url?: string; file?: string }
  width: number
  /** Bumped to read the document again (its tab reloaded, or Reload). */
  reloadKey?: number
}): React.JSX.Element {
  const [doc, setDoc] = useState<PDFDocumentProxy | null | 'loading'>('loading')
  const [aspect, setAspect] = useState(0.707)
  const [zoom, setZoom] = useState(1)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const stack = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(1)
  const zoomRef = useRef(1)
  useEffect(() => {
    pinPdf(src)
    return () => unpinPdf(src)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src.url, src.file])
  useEffect(() => {
    let dead = false
    if (reloadKey > 0) reloadPdf(src)
    void openPdf(src).then(async (d) => {
      if (dead) return
      if (d) {
        const p = await d.getPage(1)
        const v = p.getViewport({ scale: 1 })
        setAspect(v.width / v.height)
      }
      setDoc(d)
    })
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src.url, src.file, reloadKey])
  // zoom: the pages scale with a transform at once (soft), and are drawn again at the new size once the wheel rests
  useEffect(() => {
    if (!root) return
    let preview = 1
    let timer = 0
    const wheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      preview = Math.min(
        3,
        Math.max(0.5, preview * Math.exp(-Math.max(-40, Math.min(40, e.deltaY)) * 0.0095))
      )
      if (stack.current) stack.current.style.transform = `scale(${preview})`
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const next = Math.min(3, Math.max(0.5, zoomRef.current * preview))
        preview = 1
        if (stack.current) stack.current.style.transform = ''
        zoomRef.current = next
        setZoom(next)
      }, 220)
    }
    const scroll = (): void => {
      const w = (width * zoomRef.current) / aspect + 16
      setPage(Math.max(1, Math.round(root.scrollTop / w) + 1))
    }
    root.addEventListener('wheel', wheel, { passive: false })
    root.addEventListener('scroll', scroll, { passive: true })
    return () => {
      window.clearTimeout(timer)
      root.removeEventListener('wheel', wheel)
      root.removeEventListener('scroll', scroll)
    }
  }, [root, width, aspect])
  if (doc === 'loading')
    return (
      <div className="cv-pdf-loading">
        <div className="cv-shimmer" />
      </div>
    )
  if (!doc) return <p className="cv-note-empty pad">This PDF could not be opened.</p>
  return (
    <div className="cv-pdf-reader" ref={setRoot} tabIndex={0} aria-label="PDF pages">
      <div className="cv-pdf-stack" ref={stack} style={{ width: width * zoom }}>
        {Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage
            key={`${i}:${zoom}`}
            doc={doc}
            num={i + 1}
            width={width * zoom}
            root={root}
            aspect={aspect}
          />
        ))}
      </div>
      <div className="cv-pdf-tools" role="toolbar" aria-label="PDF">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => {
            const z = Math.max(0.5, Math.round((zoomRef.current - 0.25) * 4) / 4)
            zoomRef.current = z
            setZoom(z)
          }}
        >
          -
        </button>
        <span className="cv-pdf-zoom">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => {
            const z = Math.min(3, Math.round((zoomRef.current + 0.25) * 4) / 4)
            zoomRef.current = z
            setZoom(z)
          }}
        >
          +
        </button>
        <span className="cv-pdf-sep" aria-hidden="true" />
        <span aria-live="polite">
          {page} / {doc.numPages}
        </span>
      </div>
    </div>
  )
}

/**
 * Where the live page goes: the slot's box in the window, from layout, so the panel's opening animation (a scale
 * from its card) does not shrink it. A native view sized from the animated box stays small once it ends. It is the
 * box at rest (no sidebar or top bar slide): main adds the slide to the view as it moves, frame by frame.
 */
function slotBox(el: HTMLElement | null): Rect | null {
  const root = el?.closest<HTMLElement>('.cv-expand')
  if (!el || !root) return null
  let x = 0
  let y = 0
  for (let n: HTMLElement | null = el; n && n !== root; n = n.offsetParent as HTMLElement | null) {
    x += n.offsetLeft
    y += n.offsetTop
  }
  const r = root.getBoundingClientRect()
  return restRect(
    { x: r.x + x, y: r.y + y, width: el.offsetWidth, height: el.offsetHeight },
    { x: getSlide(), y: getSlideY() }
  )
}

/**
 * A card opened to reading size, on the board. It grows out of the card with a spring (transform and opacity
 * only) and goes back into it. PDFs, pictures, articles and answers are drawn here; a full page can be shown live,
 * as the one real browser view placed exactly over the body (never scaled, never moved by a transform).
 */
export function Expanded({
  m,
  from,
  cardBox,
  stage,
  tab,
  url,
  file,
  reduced,
  answerLinks,
  onClose,
  onCover,
  onGoToTab,
  onTab,
  onText,
  onStep,
  recent,
  onSwitch,
  swapped = false,
  swapFrom,
  page,
  startLive = false,
  onLive,
  onAsk,
  split,
  waiting = [],
  onOpenTab,
  swipe = 'edge'
}: Props): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const edge = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  /** Ends the close (once): set as it starts. */
  const finishClose = useRef<() => void>(() => undefined)
  /** At rest after the flight: the live page goes over its picture (it was readied out of sight meanwhile). */
  const afterRest = useRef<() => void>(() => undefined)
  const goLiveRef = useRef<(to?: number) => Promise<void>>(async () => undefined)
  const placeCompanionsRef = useRef<() => void>(() => undefined)
  const hideLive = useCallback((): void => {
    window.api.canvas.liveHide()
  }, [])
  // a card that opens live is live from its first frame (its header, its page's picture), never the reader first
  const [live, setLiveState] = useState<'off' | 'loading' | 'on'>(() =>
    startLive ||
    ((m.kind === 'video' ||
      (m.kind === 'page' && !READER) ||
      (m.kind === 'pdf' && !OWN_PDF_VIEWER)) &&
      (tab !== undefined || !!url))
      ? 'loading'
      : 'off'
  )
  // the same, for callbacks that outlive a render (IPC answers, observers, timers)
  const liveRef = useRef(live)
  const setLive = (v: 'off' | 'loading' | 'on'): void => {
    liveRef.current = v
    setLiveState(v)
  }
  const [articleEmpty, setArticleEmpty] = useState(false)
  // the address: the site name (or Ctrl+L) opens the address bar's search popover over the header
  const titleEl = useRef<HTMLDivElement>(null)
  const siteBtn = useRef<HTMLButtonElement>(null)
  const asking = useRef(false)
  const [addressOpen, setAddressOpen] = useState(false)
  // the bell's list is open: like the address popover, the live page steps aside for its picture under it
  const [bellOpen, setBellOpen] = useState(false)
  // something is over the page: it stays stepped aside
  const aside = addressOpen || bellOpen
  const asideRef = useRef(false)
  const tabRef = useRef<number | null>(tab ?? null)
  // whether the live page was already shown once on its own (opened live, a video, an app with no article)
  const autoLive = useRef(false)
  // find in the live page: the browser's own find box, in the header (the page view would cover anything below)
  const [findKey, setFindKey] = useState<number | null>(null)
  const findKeyRef = useRef(findKey)
  // The live page as it was last seen: always under the native view, so whenever the view is away (a popover over
  // it, closing) the page is still there in picture, never an empty slot. Kept fresh while the page is live (see
  // below), so closing never waits for a capture: it moves on the frame of the key, with the last picture.
  const [shot, setShot] = useState<string | null>(null)
  const shotReq = useRef(0)
  const lastGrab = useRef(0)
  const grabShot = useCallback((thumb = false): void => {
    const id = tabRef.current
    if (id === null || liveRef.current !== 'on' || !window.api.canvas.liveShot) return
    lastGrab.current = performance.now()
    const want = ++shotReq.current
    void window.api.canvas
      .liveShot(id, { thumb })
      .then(async (pic) => {
        if (!pic) return
        // decoded off the main thread first: the slot's picture then changes without a frame spent decoding it (in
        // the middle of a close, that would be a dropped frame)
        const img = new Image()
        img.src = pic
        await img.decode().catch(() => undefined)
        // a later picture (or another page) won: this one is out of date
        if (want === shotReq.current && tabRef.current === id) setShot(pic)
      })
      .catch(() => undefined)
  }, [])
  // the address the page is at now (it moves on as the person browses in it), else the card's. A tab waking up
  // passes through about:blank for a moment on its way back: the card's address stands in, so the header holds still.
  const href = (page?.url && page.url !== 'about:blank' ? page.url : '') || url
  const caps = pageCaps(href, !!page && (page.private || page.tor))
  const canEditUrl = (m.kind === 'page' || m.kind === 'video') && (tab !== undefined || !!url)
  const editRef = useRef<() => void>(() => undefined)
  const liveReq = useRef(0)
  const toReader = (): void => {
    autoLive.current = true
    liveReq.current++
    if (liveRef.current === 'off') return
    hideLive()
    liveRef.current = 'off'
    setLive('off')
    if (url) onLive?.(url, false)
  }
  // the whole board, edge to edge: the board's toolbars step away while it is open, and the reader keeps its own
  // column of text inside
  const w = Math.max(320, stage.w)
  const top = 0
  const h = Math.max(320, stage.h)
  const left = 0

  // ---- the recent tabs' highlight: under this card's tab, gliding there from the tab it replaced ----
  const strip = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const row = strip.current
    const pill = row?.querySelector<HTMLElement>('.cv-recent-pill')
    if (!row || !pill) return
    const at = (id: number | undefined): HTMLElement | null =>
      id === undefined ? null : row.querySelector<HTMLElement>(`[data-rid="${id}"]`)
    const b = at(m.id)
    if (!b) return
    pill.style.width = `${b.offsetWidth}px`
    const to = b.offsetLeft
    // where the last preview's pill was this moment (it may still have been gliding): it carries on from there
    const prev = pillNow && performance.now() - pillNow.t < 600 ? pillNow : null
    const a = at(swapFrom)
    const from = reduced || !swapped ? to : (prev?.x ?? (a ? a.offsetLeft : to))
    pill.style.transform = `translateX(${from}px)`
    if (from === to) {
      pillNow = null
      return
    }
    const s = new Spring(
      from,
      'snappy',
      (x, sp) => {
        pill.style.transform = `translateX(${x}px)`
        pillNow = { x, v: sp.velocity, t: performance.now() }
      },
      0.25
    )
    void s.to(to, { velocity: prev?.v ?? 0 }).then(() => (pillNow = null))
    return () => s.stop()
    // once, on mount: the row is fixed while the preview is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- the flight: the card's picture grows into the page, and shrinks back into it ----
  /** 0: the card's picture, where it is on the board; 1: the page at rest, edge to edge. */
  const prog = useRef<Spring | null>(null)
  const flight = useRef<Flight | null>(null)
  const restRadius = useRef(12)
  const covered = useRef(false)
  const rest = useRef(deferred())
  const still = (): boolean => reduced || reducedMotion()
  /** Where the flight starts (and ends, closing): the card's picture as it is on the board now. */
  const measure = (): Flight | null => {
    const r = root.current
    const b = body.current
    const p = panel.current
    if (!r || !b || !p) return null
    restRadius.current = parseFloat(getComputedStyle(p).borderTopLeftRadius) || 12
    const card = cardTarget(m.id, r)
    const box = card?.box ?? (cardBox?.() || from)
    if (!box || box.w < 4 || box.h < 4) return null
    // the page's area in the panel (layout, so any transform on it now does not count)
    const bx = b.offsetLeft
    const by = b.offsetTop
    const bw = b.offsetWidth
    const bh = b.offsetHeight
    if (bw < 4 || bh < 4) return null
    // the picture in the slot and the one on the card are the same picture, each covering its box from the top left:
    // scaled so that one lies exactly on the other, the flight starts on the card's very pixels
    const slotImg = b.querySelector<HTMLImageElement>('.cv-live-slot > img')
    const cardImg = card?.img ?? null
    let s = Math.max(box.w / bw, box.h / bh)
    let matched = false
    const ib = card?.imgBox
    if (slotImg && cardImg && ib && slotImg.naturalWidth > 0 && cardImg.naturalWidth > 0) {
      const own = (iw: number, ih: number, cw: number, ch: number): number =>
        iw * Math.max(cw / iw, ch / ih)
      const k =
        own(cardImg.naturalWidth, cardImg.naturalHeight, ib.w, ib.h) /
        own(slotImg.naturalWidth, slotImg.naturalHeight, bw, bh)
      if (Number.isFinite(k) && k > 0 && box.w / k <= bw + 1 && ib.h / k <= bh + 1) {
        s = k
        matched = true
      }
    }
    const rw = Math.min(bw, box.w / s)
    const rh = Math.min(bh, box.h / s)
    return {
      s,
      tx: box.x - s * bx,
      ty: box.y - s * by,
      t: by,
      l: bx,
      r: Math.max(0, p.offsetWidth - bx - rw),
      b: Math.max(0, p.offsetHeight - by - rh),
      pw: p.offsetWidth,
      ph: p.offsetHeight,
      r0: card?.radius ?? 14,
      // the same pixels: shown from the first frame (a short fade only hides the card's frame around them); other
      // content than the card's (a note, the reader) fades in over the first part of the flight
      fade: matched ? 0.1 : 0.24
    }
  }
  /** Draw the flight at `p` (transform, clip and opacity only: nothing is laid out again). */
  const draw = (p: number): void => {
    const el = panel.current
    const f = flight.current
    const sc = scrim.current
    if (sc) sc.style.opacity = String(Math.max(0, Math.min(1, p)) ** 2.2)
    const hd = head.current
    if (hd) hd.style.opacity = p >= 1 ? '' : String(Math.max(0, Math.min(1, (p - 0.9) / 0.08)))
    if (!el) return
    if (p >= 1 || !f) {
      // at rest: no transform at all (crisp text, the native page lines up with it exactly)
      el.style.transform = ''
      el.style.clipPath = ''
      el.style.opacity = ''
      if (edge.current) edge.current.style.opacity = '0'
      return
    }
    const q = 1 - p
    const s = f.s + (1 - f.s) * p
    const tx = f.tx * q
    const ty = f.ty * q
    const it = f.t * q
    const ir = f.r * q
    const ib = f.b * q
    const il = f.l * q
    // the corners keep their size on screen as it grows (the clip is in the panel's own, scaled, units)
    const rad = f.r0 + (restRadius.current - f.r0) * p
    const op = Math.max(0, Math.min(1, p / f.fade))
    el.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`
    el.style.clipPath = `inset(${it}px ${ir}px ${ib}px ${il}px round ${rad / s}px)`
    el.style.opacity = String(op)
    const ed = edge.current
    if (ed) {
      const { pw, ph } = f
      ed.style.transform = `translate(${tx + s * il}px, ${ty + s * it}px)`
      ed.style.width = `${s * (pw - il - ir)}px`
      ed.style.height = `${s * (ph - it - ib)}px`
      ed.style.borderRadius = `${rad}px`
      // the shadow and rim are for the flight: at rest the page meets the board's own edges
      ed.style.opacity = String(op * Math.min(1, q * 6))
    }
  }
  const drawRef = useRef(draw)
  useLayoutEffect(() => {
    drawRef.current = draw
  })
  /** The spring that drives it, made once its distances are known (it rests within half a pixel). */
  const spring = (): Spring => {
    if (prog.current) return prog.current
    const f = flight.current
    const travel = f
      ? Math.max(Math.abs(f.tx), Math.abs(f.ty), (1 - f.s) * Math.max(w, h), f.t, f.b, f.l, f.r, 1)
      : 1
    prog.current = new Spring(
      0,
      'smooth',
      (v) => {
        drawRef.current(v)
        // closing: done once it is all but there (the panel is invisible by then); the board is the person's again
        if (closing.current && v <= 0.004) finishClose.current()
      },
      Math.min(0.002, 0.75 / travel)
    )
    return prog.current
  }
  const fxLow = (): boolean => document.documentElement.dataset['fx'] === 'low'
  const settle = (): void => {
    if (closing.current) return
    drawRef.current(1)
    rest.current.done = true
    rest.current.resolve()
    afterRest.current()
    // the card under it is hidden only now (the board draws again for that: never in flight, where it would cost
    // frames); back from a turned-around close, it is hidden again by hand (see uncoverCard)
    if (!covered.current) {
      covered.current = true
      coverCard(m.id, true)
      onCover?.(true)
    }
  }
  const open = (velocity?: number): void => {
    const s = spring()
    void s.to(1, { spring: fxLow() ? 'exit' : 'smooth', velocity }).then(() => {
      if (!closing.current && s.value >= 1) settle()
    })
  }
  useLayoutEffect(() => {
    if (swapped || still() || !panel.current) {
      // in place of the last card's preview (or no motion): at rest from its first frame, nothing flies or fades
      drawRef.current(1)
      covered.current = true
      onCover?.(true)
      rest.current.done = true
      rest.current.resolve()
      return
    }
    flight.current = measure()
    drawRef.current(0)
    open()
    return () => prog.current?.stop()
    // runs once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // the outgoing preview's page stays on screen until this one's is ready (see hideLiveSoon): taken over here. A card
  // that shows no page hides it once its own body has been drawn.
  useEffect(() => {
    if (!swapped) return
    keepLive()
    if (liveRef.current !== 'off') return
    const r = requestAnimationFrame(() => hideLive())
    return () => cancelAnimationFrame(r)
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => hideLiveSoon(), [])
  // main sends page shortcuts (Ctrl+F, Ctrl+L, Ctrl+D, zoom, back) to this card's page while it is open
  useEffect(() => {
    window.api.canvas.preview?.(true, tab ?? null)
  }, [tab])
  useEffect(() => () => window.api.canvas.preview?.(false, null), [])
  /** Put the live page over the slot as it is now (unless something has it stepped aside, or it is in flight). */
  const placeLive = useCallback((): void => {
    const r = slotBox(slot.current)
    const id = tabRef.current
    if (
      !r ||
      id === null ||
      liveRef.current !== 'on' ||
      asideRef.current ||
      closing.current ||
      !rest.current.done
    )
      return
    window.api.canvas.liveMove(id, r)
  }, [])

  const close = useCallback((): void => {
    if (closing.current) return
    closing.current = true
    liveReq.current++ // a page still on its way in stays out
    rest.current = deferred()
    // the page steps out this very frame: its last picture is under it already, the same pixels
    hideLive()
    // (no capture now: one in flight costs frames. The picture under it is kept fresh while the page is used, and
    // main makes the last one the card's once the flight is over)
    root.current?.classList.add('closing') // clicks go to the board again (a card clicked now opens it back up)
    // the card shows again under the panel as it lands, at once and without the board drawing again mid-flight (its
    // own state follows when the preview is gone)
    covered.current = false
    coverCard(m.id, false)
    let done = false
    finishClose.current = () => {
      if (done || !closing.current) return
      done = true
      prog.current?.stop()
      onClose()
    }
    if (still() || !panel.current) {
      finishClose.current()
      return
    }
    // from rest: back to where the card is now (the board may have moved under it). Mid-flight: the same card,
    // turned around, its speed kept
    const s = spring()
    if (s.value >= 0.999 || !flight.current) {
      const f = measure()
      if (!f) {
        finishClose.current()
        return
      }
      flight.current = f
    }
    void s.to(0, { spring: 'exit' }).then(() => finishClose.current())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideLive, reduced, onClose, cardBox, from, grabShot])
  const closeRef = useRef(close)
  useLayoutEffect(() => {
    closeRef.current = close
  })
  // the card clicked again while it closes (Canvas gives it a new `from`): it turns around and grows back, its speed
  // kept, the live page coming back once it is at rest
  const firstFrom = useRef(from)
  useEffect(() => {
    if (from === firstFrom.current || !closing.current) return
    closing.current = false
    finishClose.current = () => undefined
    root.current?.classList.remove('closing')
    open()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from])
  useLayoutEffect(() => {
    afterRest.current = () => {
      if (liveRef.current === 'on') {
        placeLive()
        placeCompanionsRef.current()
      } else if (liveRef.current === 'loading' && autoLive.current) void goLiveRef.current()
    }
  })
  const openFind = (): void => {
    if (liveRef.current === 'on') setFindKey((k) => (k ?? 0) + 1)
  }
  const openFindRef = useRef(openFind)
  useLayoutEffect(() => {
    openFindRef.current = openFind
  })
  const [zoom, setZoom] = useState<{ level: number; base: number } | null>(null)
  const readZoom = useCallback((): void => {
    if (liveRef.current !== 'on') return setZoom(null)
    void window.api
      .siteInfo()
      .then((i) => setZoom(i ? { level: i.zoom, base: i.defaultZoom } : null))
  }, [])
  // two fingers from the touchpad's top edge, sliding down: put the preview away (Windows; see shared/edgeSwipe)
  useEffect(() => {
    if (swipe === 'off') return
    const g = new EdgeSwipe()
    g.zone = SWIPE_ZONES[swipe]
    return window.api.canvas.onTouchpad((dx, dy, fingers, y) => {
      if (g.touch({ dx, dy, fingers, y })) closeRef.current()
    })
  }, [swipe])
  // the keys main routes here: pressed in the live page (which holds the keyboard) or caught before the board
  useEffect(
    () =>
      window.api.canvas.onPreviewKey?.((k) => {
        if (asking.current) return
        if (k === 'address') editRef.current()
        else if (k === 'find') openFindRef.current()
        else if (k === 'zoom') readZoom()
        else if (findKeyRef.current !== null) {
          // Esc in the page with find open: find goes first
          window.api.stopFind()
          setFindKey(null)
        } else closeRef.current()
      }),
    [readZoom]
  )
  useEffect(() => {
    findKeyRef.current = findKey
  }, [findKey])

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      // the search popover, the find box and the dock have keys of their own (Esc closes them, not the preview)
      if (
        asking.current ||
        (e.target instanceof Element && e.target.closest('.pal, .findbar, .cv-dock'))
      )
        return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      if (!typing && onStep && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        // the page stays on screen until the next card's is ready (no hide here: see hideLiveSoon)
        onStep(e.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [close, onStep])

  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    if (!href) return
    void navigator.clipboard.writeText(href).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }

  const canLive =
    (m.kind === 'page' || m.kind === 'video' || (m.kind === 'pdf' && !OWN_PDF_VIEWER)) &&
    (tab !== undefined || !!url)
  // shown only in the page itself: a video, and a PDF while Panes' own reader is off
  const liveOnly =
    m.kind === 'video' || (m.kind === 'page' && !READER) || (m.kind === 'pdf' && !OWN_PDF_VIEWER)
  // the first page this preview shows, when it took another's place: that one stays up until this one is ready
  const firstLive = useRef(true)
  /**
   * Show the live page. It is readied at once, out of sight at the slot's size, while the panel grows (its picture
   * in the slot meanwhile), and goes over the picture once the panel is at rest and the page has painted: the same
   * pixels at the same place, so the change cannot be seen. `to`: a tab just made for this card, not yet in props.
   */
  const goLive = async (to?: number): Promise<void> => {
    autoLive.current = true
    if (liveRef.current === 'on' && to === undefined) return
    const req = ++liveReq.current
    if (liveRef.current !== 'on') {
      liveRef.current = 'loading'
      flushSync(() => setLive('loading'))
    }
    const r = slotBox(slot.current)
    if (!r) {
      liveRef.current = 'off'
      setLive('off')
      if (swapped) hideLive()
      return
    }
    const hold = swapped && firstLive.current ? (m.snap ? 450 : 2500) : 0
    firstLive.current = false
    const id = await window.api.canvas.liveOpen({
      tab: to ?? tabRef.current ?? tab,
      url: to === undefined ? url : undefined,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      defer: true,
      hold
    })
    if (req !== liveReq.current || closing.current) return
    if (id === null) {
      liveRef.current = 'off'
      setLive('off')
      hideLive() // (a page kept up for the swap goes too)
      return
    }
    tabRef.current = id
    if (tab === undefined && to === undefined) onTab(id)
    // ready: shown once the panel is at rest (now, unless it is still growing)
    await rest.current.promise
    if (req !== liveReq.current || closing.current) return
    liveRef.current = 'on'
    setLive('on')
    const rNow = slotBox(slot.current)
    if (asideRef.current)
      hideLive() // a popover opened while it loaded: it stays stepped aside
    else if (rNow) window.api.canvas.liveMove(id, rNow)
    if (url) onLive?.(url, true)
  }
  const editAddress = async (): Promise<void> => {
    if (asking.current || !titleEl.current) return
    asking.current = true
    // the live page is a native view over the board and would hide the popover: it steps aside for its picture
    // (kept fresh, so there is no wait) while the popover is up, and comes back where it was
    grabShot()
    flushSync(() => setAddressOpen(true))
    const text = await askSearch(anchorOver(titleEl.current), href ?? '')
    asking.current = false
    setAddressOpen(false)
    if (text) void submitUrl(text)
  }
  const openBell = (): void => {
    grabShot() // the page stands in as a picture while the list covers it
    setBellOpen(true)
  }
  // the bell lists the other sites: one whose tab is in front of the person is being looked at
  const others = waiting.filter(
    (w) => !w.tabs.some((id) => id === tab || split?.some((p) => p.tab === id))
  )
  const submitUrl = async (input: string): Promise<void> => {
    const text = input.trim()
    if (!text || text === href) return
    const id = await window.api.canvas.navigate(tab ?? null, text)
    if (id === null) return
    if (tab === undefined) onTab(id)
    // the new page is shown as it loads; its words are read again when Reader is picked
    void goLive(id)
  }
  useLayoutEffect(() => {
    editRef.current = () => void editAddress()
  })
  // opened for the person by the assistant, or a video (it only plays in the page): its page is readied from the
  // first frame, while the panel grows, and shown once it is at rest
  useLayoutEffect(() => {
    goLiveRef.current = goLive
  })
  useEffect(() => {
    if (autoLive.current || (!startLive && !(liveOnly && canLive))) return
    // marked done only when it runs, so a change meanwhile (the card's details settling) re-arms it
    const t = window.setTimeout(() => {
      if (autoLive.current) return
      autoLive.current = true
      void goLiveRef.current()
    }, 0)
    return () => window.clearTimeout(t)
  }, [startLive, liveOnly, canLive])
  // a page with no article to read (an app, a map) is a snapshot in the reader: it opens live instead
  useEffect(() => {
    if (!articleEmpty || live !== 'off' || !canLive || autoLive.current) return
    autoLive.current = true
    void goLiveRef.current()
  }, [articleEmpty, live, canLive])
  // the page's picture is kept up to date while it is live (closing and popovers use it at once, never waiting):
  // soon after it shows, every few seconds, and when the pointer comes up to the header (on its way to close)
  useEffect(() => {
    if (live !== 'on' || aside) return
    const grab = (): void => {
      if (!document.hidden && !closing.current) grabShot()
    }
    const first = window.setTimeout(grab, 500)
    // for what moves on its own (a video, an animation); a page that is used or loads sends a fresh one by itself
    const every = window.setInterval(grab, 4000)
    const off = window.api.canvas.onLivePic?.((id, pic) => {
      if (id !== tabRef.current || closing.current) return
      ++shotReq.current
      const img = new Image()
      img.src = pic
      void img
        .decode()
        .catch(() => undefined)
        .then(() => {
          if (id === tabRef.current && !closing.current) setShot(pic)
        })
    })
    return () => {
      window.clearTimeout(first)
      window.clearInterval(every)
      off?.()
    }
  }, [live, aside, grabShot])
  const onHeadEnter = (): void => {
    if (liveRef.current === 'on' && performance.now() - lastGrab.current > 400) grabShot()
  }
  const panes =
    split && split.length > 1 && tab !== undefined && split.some((p) => p.tab === tab)
      ? split
      : null
  const splitKey = panes ? panes.map((p) => p.tab).join(',') : ''
  // the live page follows the slot if the window is resized
  useEffect(() => {
    tabRef.current = tab ?? tabRef.current
  }, [tab])
  // the address popover over the header: the live page steps aside for its picture, and comes back where the slot
  // is. (The hover sidebar and top bar no longer move it aside: main slides the view with them, frame by frame.)
  useEffect(() => {
    asideRef.current = aside
    if (live === 'off') return
    // while it is still loading too: hiding cancels the open waiting in main, which would show it over the popover
    if (aside) hideLive()
    else placeLive()
  }, [aside, live, hideLive, placeLive])
  // the zoom level shows in the bar while it is not the site's usual one
  useEffect(() => {
    if (live === 'on') readZoom()
  }, [live, readZoom])
  // (and when a split comes or goes: the slot is a new element then, at a new size)
  useEffect(() => {
    if (live !== 'on' || !slot.current) return
    const el = slot.current
    placeLive()
    // through placeLive: a resize while a popover is over the page must not bring the page back over it
    const ro = new ResizeObserver(placeLive)
    ro.observe(el)
    return () => ro.disconnect()
  }, [live, splitKey, placeLive])

  // ---- a split view: the other panes, live beside this card's page ----
  const paneEls = useRef(new Map<number, HTMLDivElement>())
  const placeCompanions = useCallback((): void => {
    if (liveRef.current !== 'on' || asideRef.current || closing.current || !rest.current.done)
      return
    const list: Array<{ id: number; rect: Rect }> = []
    for (const [id, el] of paneEls.current) {
      const r = slotBox(el)
      if (r) list.push({ id, rect: r })
    }
    window.api.canvas.liveCompanions?.(list)
  }, [])
  useLayoutEffect(() => {
    placeCompanionsRef.current = placeCompanions
  })
  useEffect(() => {
    if (live !== 'on' || aside || !splitKey) return
    placeCompanions()
    const ro = new ResizeObserver(placeCompanions)
    for (const el of paneEls.current.values()) ro.observe(el)
    return () => {
      ro.disconnect()
      window.api.canvas.liveCompanions?.([])
    }
  }, [live, aside, splitKey, placeCompanions])
  const paneRef =
    (id: number) =>
    (el: HTMLDivElement | null): void => {
      if (el) paneEls.current.set(id, el)
      else paneEls.current.delete(id)
    }

  /** What was picked in the page menu (the header's More button, or a right-click on the header). */
  const onPagePick = (what: PageMenuPick | null): void => {
    if (what === 'popout') onGoToTab()
    else if (what === 'ask') onAsk?.()
    else if (what === 'find') openFind()
    else if (what === 'site') openSite()
    else if (what === 'reader') toReader()
    else if (what === 'live') void goLive()
    else if (what === 'close') close()
  }
  const pageMenu = (x: number, y: number): void => {
    const id = tabRef.current
    if (id === null || !window.api.pageMenu) return
    void window.api
      .pageMenu(id, x, y, canLive && !liveOnly ? live === 'on' : undefined)
      .then(onPagePick)
  }
  /** The site's settings (permissions, blocker, data): the address bar's own panel, a native view over the page. */
  const openSite = (): void => {
    const r = (siteBtn.current ?? titleEl.current)?.getBoundingClientRect()
    if (r) window.api.toggleSitePanel({ x: r.x, y: r.y, width: r.width, height: r.height })
  }
  const nav = (how: 'back' | 'forward' | 'reload' | 'stop'): void => {
    const id = tabRef.current
    if (id !== null) window.api.canvas.liveNav(id, how)
  }
  const zoomLabel =
    live === 'on' && zoom && Math.abs(zoom.level - zoom.base) > 0.01
      ? `${zoomPercent(zoom.level)}%`
      : null

  const src = m.pdf ?? { url, file }
  const [pdfKey, setPdfKey] = useState(0)
  const [wasLoading, setWasLoading] = useState(!!page?.loading)
  if (!!page?.loading !== wasLoading) {
    setWasLoading(!!page?.loading)
    if (wasLoading && ownPdf(m.kind) && live === 'off') setPdfKey((k) => k + 1)
  }
  const bodyView = ownPdf(m.kind) ? (
    <PdfReader src={src} width={Math.min(PDF_W, w - 48)} reloadKey={pdfKey} />
  ) : m.kind === 'image' ? (
    m.image ? (
      <ImageViewer src={m.image} />
    ) : (
      <p className="cv-note-empty pad">No picture to show.</p>
    )
  ) : m.kind === 'answer' ? (
    <div className="cv-answer-full">
      <p className="cv-answer-q">{m.title}</p>
      {m.text !== undefined && m.placement === 'note' && onText ? (
        <NoteBody text={m.text} onText={onText} onLink={answerLinks} />
      ) : m.text ? (
        <AnswerText text={m.text} onLink={answerLinks} />
      ) : (
        <span className="cv-thinking">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  ) : m.kind === 'video' ? (
    <div className="cv-video-full">
      {m.image && <Img src={m.image} />}
      <p>Videos play in the live page.</p>
    </div>
  ) : m.kind === 'pdf' ? (
    // shown for a moment, until the browser's own PDF viewer is up
    <div className="cv-video-full">
      <p>Opening the PDF...</p>
    </div>
  ) : (articleEmpty || !READER) && m.snap ? (
    // nothing to read on this page (an app, a map, a picture): how it looked is the next best thing
    <div className="cv-snap-full">
      <img src={m.snap} alt="" decoding="async" draggable={false} />
    </div>
  ) : (
    <ReaderView
      key={url ?? tab}
      tab={tab}
      url={tab === undefined ? url : undefined}
      stored={m.text}
      onEmpty={() => setArticleEmpty(true)}
    />
  )

  return (
    <div className="cv-expand" ref={root} role="dialog" aria-modal="false" aria-label={m.title}>
      <div className="cv-scrim" ref={scrim} onPointerDown={() => close()} />
      <div className="cv-panel" ref={panel} style={{ left, top, width: w, height: h }}>
        {/* three zones: the page (nav, address) on the left, how to see it in the middle, what to do on the right.
            The rest (bookmark, copy link, find, zoom, pop out) is in More and on a right-click of the bar. */}
        <header
          className="cv-panel-head"
          ref={head}
          onPointerEnter={onHeadEnter}
          onContextMenu={(e) => {
            // the board's own menu would sit under the live page: the page's menu is a native one, over it
            e.preventDefault()
            e.stopPropagation()
            pageMenu(e.clientX, e.clientY)
          }}
        >
          <div className="cv-hzone cv-hzone-l">
            {live !== 'off' && (
              <div className="cv-nav" role="group" aria-label="Page navigation">
                <button
                  type="button"
                  aria-label="Back"
                  title="Back (Alt+Left)"
                  disabled={!page?.canGoBack}
                  onClick={() => nav('back')}
                >
                  <BackIcon />
                </button>
                <button
                  type="button"
                  aria-label="Forward"
                  title="Forward (Alt+Right)"
                  disabled={!page?.canGoForward}
                  onClick={() => nav('forward')}
                >
                  <ForwardIcon />
                </button>
                {page?.loading ? (
                  <button
                    type="button"
                    aria-label="Stop"
                    title="Stop loading"
                    onClick={() => nav('stop')}
                  >
                    <StopIcon />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="Reload"
                    title="Reload (Ctrl+R)"
                    onClick={() => nav('reload')}
                  >
                    <ReloadIcon />
                  </button>
                )}
              </div>
            )}
            <div className="cv-panel-title" title={m.title} ref={titleEl}>
              {/* the site icon doubles as its settings, as in the address bar */}
              {live !== 'off' && caps.site ? (
                <button
                  type="button"
                  ref={siteBtn}
                  className="cv-panel-icon cv-sitebtn"
                  aria-label="Site settings"
                  title="Site settings: permissions, blocker, data"
                  onClick={openSite}
                >
                  <HeadIcon m={m} />
                </button>
              ) : (
                <span className="cv-panel-icon" aria-hidden="true">
                  <HeadIcon m={m} />
                </span>
              )}
              <strong
                className={canEditUrl ? 'edit' : undefined}
                onClick={canEditUrl ? () => void editAddress() : undefined}
              >
                {m.title}
              </strong>
              {canEditUrl ? (
                <button
                  type="button"
                  className="cv-panel-site"
                  title={`${href ?? m.site} (Ctrl+L to change)`}
                  onClick={() => void editAddress()}
                >
                  {m.site || href}
                </button>
              ) : (
                m.site && <span>{m.site}</span>
              )}
            </div>
          </div>
          <div className="cv-hzone cv-hzone-c">
            {recent && recent.length > 1 && onSwitch && (
              <div className="cv-recent" role="tablist" aria-label="Recent tabs" ref={strip}>
                <i className="cv-recent-pill" aria-hidden="true" />
                {recent.map((r) => (
                  <button
                    type="button"
                    role="tab"
                    key={r.id}
                    data-rid={r.id}
                    aria-selected={r.id === m.id}
                    className={r.id === m.id ? 'on' : ''}
                    title={`${r.title}${r.site ? ` - ${r.site}` : ''}`}
                    onClick={() => {
                      // the page stays on screen until the next one is ready to take its place
                      if (r.id !== m.id) onSwitch(r.id)
                    }}
                  >
                    <HeadIcon m={r} />
                    <span>{r.title || r.site}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* what comes and goes sits leftmost, so Ask, the bell, More and the way back never move */}
          <div className="cv-hzone cv-hzone-r cv-hacts">
            {/* no reader: a page that did not open live gets a way to try again, nothing else */}
            {canLive && live === 'off' && (
              <button type="button" className="cv-pill" onClick={() => void goLive()}>
                <LiveIcon />
                Open live
              </button>
            )}
            {panes && (
              <button
                type="button"
                className="cv-hbtn"
                aria-label="Unsplit"
                title="Unsplit: the tabs stay open, each on its own"
                onClick={() => window.api.unsplit()}
              >
                <UnsplitIcon />
              </button>
            )}
            {m.isTab && (m.audible || m.muted) ? (
              <button
                type="button"
                className={'cv-hbtn' + (m.muted ? ' on' : '')}
                aria-label={m.muted ? 'Unmute' : 'Mute'}
                title={m.muted ? 'Unmute' : 'Mute'}
                onClick={() => window.api.toggleMute(m.id)}
              >
                <SpeakerIcon muted={m.muted} />
              </button>
            ) : null}
            {zoomLabel && (
              <button
                type="button"
                className="cv-hzoom"
                title="Page zoom (Ctrl+0 for the usual size)"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  pageMenu(r.left, r.bottom + 4)
                }}
              >
                {zoomLabel}
              </button>
            )}
            {ownPdf(m.kind) && live === 'off' && (
              <button
                type="button"
                className="cv-hbtn"
                aria-label="Reload"
                title="Reload the PDF"
                onClick={() => setPdfKey((k) => k + 1)}
              >
                <ReloadIcon />
              </button>
            )}
            {onAsk && (
              <button
                type="button"
                className="cv-hbtn cv-hask"
                aria-label="Ask about this page"
                title="Ask about this page"
                onClick={onAsk}
              >
                Ask
              </button>
            )}
            {onOpenTab && (
              <PreviewInbox
                tabs={others}
                open={bellOpen}
                onOpen={openBell}
                onClose={() => setBellOpen(false)}
                onPick={(id) => {
                  setBellOpen(false)
                  onOpenTab(id)
                }}
              />
            )}
            {tab !== undefined ? (
              <button
                type="button"
                className="cv-hbtn"
                aria-label="More"
                aria-haspopup="menu"
                title="More: bookmark, copy link, find, zoom, pop out..."
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  pageMenu(r.left, r.bottom + 4)
                }}
              >
                <MoreIcon vertical />
              </button>
            ) : (
              // no tab yet, so no page menu: what it would offer that needs none
              <>
                {href && /^https?:/i.test(href) ? (
                  <button
                    type="button"
                    className={'cv-hbtn' + (copied ? ' on' : '')}
                    aria-label={copied ? 'Link copied' : 'Copy link'}
                    title={copied ? 'Copied' : 'Copy link'}
                    onClick={copy}
                  >
                    {copied ? <CheckGlyph /> : <LinkGlyph />}
                  </button>
                ) : null}
                {m.kind === 'page' || m.kind === 'video' || /^(https?|file):/i.test(url ?? '') ? (
                  <button
                    type="button"
                    className="cv-hbtn"
                    aria-label="Pop out as a tab"
                    title="Pop out: open as a tab and leave the canvas"
                    onClick={onGoToTab}
                  >
                    <PopOutGlyph />
                  </button>
                ) : null}
              </>
            )}
            {/* back down into its card on the board (the page stays open as a tab): an arrow down, not a close */}
            <button
              type="button"
              className="cv-hbtn"
              aria-label="Back to the board"
              title="Back to the board (Esc)"
              onClick={() => close()}
            >
              <ChevronDownIcon />
            </button>
          </div>
        </header>
        {findKey !== null && live === 'on' && (
          <div className="cv-findrow">
            <FindBar focusKey={findKey} onClose={() => setFindKey(null)} />
          </div>
        )}
        <div className="cv-panel-body" ref={body}>
          {live === 'off'
            ? bodyView
            : (() => {
                const own = (
                  <div className="cv-live-slot" ref={slot} key={tab ?? 'own'}>
                    {/* always under the native view: whenever it is away (in flight, a popover over it, closing),
                      the page is still there in picture, never an empty slot. Decoded with the frame (sync): a
                      picture that came a frame late would be a blank frame */}
                    {((live === 'on' && shot) || m.snap) && (
                      <img
                        src={(live === 'on' && shot) || m.snap}
                        alt=""
                        decoding="sync"
                        draggable={false}
                      />
                    )}
                    {/* a page drawn off screen (Settings, Draw pages inside the window) is drawn here itself, over its
                      picture, from the first frame of the flight: it moves with the panel instead of standing in
                      as a picture until the panel is at rest (preload/osr.ts finds it by its tab) */}
                    {tab !== null && <canvas className="cv-live-osr" data-osr-tab={tab} />}
                    {live === 'loading' && <span className="cv-live-bar" />}
                  </div>
                )
                if (!panes) return own
                return (
                  <div className="cv-live-split">
                    {panes.map((p) =>
                      p.tab === tab ? (
                        own
                      ) : (
                        <div className="cv-live-slot" key={p.tab} ref={paneRef(p.tab)}>
                          {p.snap && <img src={p.snap} alt="" decoding="sync" draggable={false} />}
                        </div>
                      )
                    )}
                  </div>
                )
              })()}
        </div>
      </div>
      {/* the flight's soft shadow and light rim, over the panel's clipped edge (see draw) */}
      <div className="cv-fly-edge" ref={edge} aria-hidden="true" />
    </div>
  )
}
