import { Favicon, Img } from './Img'
import { animate } from 'motion'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { parseMarkdown, type Block, type Inline } from '@shared/ai/markdown'
import type { CanvasReaderDoc } from '@shared/ai/canvasItems'
import type { PageMenuPick, Rect, TabInfo } from '@shared/types'
import { pageCaps, restRect, zoomPercent } from '@shared/ai/previewBar'
import type { CardModel } from './model'
import { LiveIcon, UnsplitIcon } from './icons'
import {
  BackIcon,
  ChevronDownIcon,
  ForwardIcon,
  MoreIcon,
  ReloadIcon,
  SearchIcon,
  SiteIcon,
  SpeakerIcon,
  StarIcon,
  StopIcon
} from '@renderer/components/icons'
import { FindBar } from '@renderer/components/FindBar'
import { getSlide, getSlideY } from '@renderer/slide'
import { openPdf, pinPdf, reloadPdf, unpinPdf } from './pdf'
import { anchorOver, askSearch } from './askSearch'

/** Opening and closing move alike: one smooth ease, no spring overshoot (the card it grows from must line up). */
const MORPH = { duration: 0.32, ease: [0.32, 0.72, 0, 1] } as const
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
  /** Where it sits among its section's cards, for the "2 / 5" in the header. */
  place?: { at: number; of: number }
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
const PrevGlyph = (): React.JSX.Element => <Glyph d="M9.8 3.6 5.4 8l4.4 4.4" />
const NextGlyph = (): React.JSX.Element => <Glyph d="M6.2 3.6 10.6 8l-4.4 4.4" />

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
  place,
  page,
  startLive = false,
  onLive,
  onAsk,
  split
}: Props): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  const [live, setLiveState] = useState<'off' | 'loading' | 'on'>('off')
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
  const addressOpenRef = useRef(false)
  const tabRef = useRef<number | null>(tab ?? null)
  // whether the live page was already shown once on its own (opened live, a video, an app with no article)
  const autoLive = useRef(false)
  // find in the live page: the browser's own find box, in the header (the page view would cover anything below)
  const [findKey, setFindKey] = useState<number | null>(null)
  const findKeyRef = useRef(findKey)
  // the live page as it was last seen: always under the native view, so whenever the view is away (moving, loading,
  // a popover over it, closing) the page is still there in picture, never an empty slot
  const [shot, setShot] = useState<string | null>(null)
  const takeShot = async (): Promise<boolean> => {
    const id = tabRef.current
    if (liveRef.current !== 'on' || id === null) return false
    const pic = await Promise.race([
      window.api.canvas.liveShot?.(id) ?? Promise.resolve(null),
      new Promise<null>((r) => setTimeout(() => r(null), 400))
    ]).catch(() => null)
    if (pic) flushSync(() => setShot(pic))
    return !!pic
  }
  // the address the page is at now (it moves on as the person browses in it), else the card's
  const href = page?.url || url
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
  const fromTf = `translate(${from.x - left}px, ${from.y - top}px) scale(${from.w / w}, ${from.h / h})`

  useLayoutEffect(() => {
    if (reduced || !panel.current) return
    panel.current.style.transformOrigin = '0 0'
    // the live page is a native view and cannot grow with the panel: it waits for this (see goLive)
    const ctrl = animate(
      panel.current,
      {
        transform: [fromTf, 'translate(0px, 0px) scale(1, 1)'],
        opacity: [0, 1, 1]
      },
      { ...MORPH, opacity: { duration: MORPH.duration, times: [0, 0.35, 1] } }
    )
    openDone.current = Promise.race([
      ctrl.finished.then(
        () => undefined,
        () => undefined
      ),
      new Promise<void>((r) => setTimeout(r, 450))
    ])
    void openDone.current.then(() => onCover?.(true))
    const sCtrl = scrim.current
      ? animate(scrim.current, { opacity: [0, 1] }, { duration: 0.22 })
      : null
    const bCtrl = body.current
      ? animate(body.current, { opacity: [0, 1] }, { duration: 0.2, delay: 0.12 })
      : null
    return () => {
      ctrl.stop()
      sCtrl?.stop()
      bCtrl?.stop()
    }
    // runs once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openDone = useRef<Promise<void>>(Promise.resolve())
  const hideLive = useCallback((): void => {
    window.api.canvas.liveHide()
  }, [])
  useEffect(() => () => hideLive(), [hideLive])
  // main sends page shortcuts (Ctrl+F, Ctrl+L, Ctrl+D, zoom, back) to this card's page while it is open
  useEffect(() => {
    window.api.canvas.preview?.(true, tab ?? null)
  }, [tab])
  useEffect(() => () => window.api.canvas.preview?.(false, null), [])
  /** Put the live page over the slot as it is now (unless something has it stepped aside). */
  const placeLive = useCallback((): void => {
    const r = slotBox(slot.current)
    const id = tabRef.current
    if (!r || id === null || liveRef.current !== 'on' || addressOpenRef.current || closing.current)
      return
    window.api.canvas.liveMove(id, r)
  }, [])

  const close = useCallback(async (): Promise<void> => {
    if (closing.current) return
    closing.current = true
    // a fresh picture stands in for the page while the panel shrinks back into its card
    if (live !== 'off') await takeShot()
    hideLive()
    if (!reduced && panel.current) {
      if (body.current && live === 'off')
        void animate(body.current, { opacity: 0 }, { duration: 0.1 })
      if (scrim.current) void animate(scrim.current, { opacity: 0 }, { duration: 0.2 })
      const to = cardBox?.() ?? from
      const toTf = `translate(${to.x - left}px, ${to.y - top}px) scale(${to.w / w}, ${to.h / h})`
      onCover?.(false)
      await animate(
        panel.current,
        { transform: ['translate(0px, 0px) scale(1, 1)', toTf], opacity: [1, 1, 0] },
        { ...MORPH, opacity: { duration: MORPH.duration, times: [0, 0.55, 1] } }
      ).finished
    } else onCover?.(false)
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideLive, reduced, onClose, from, cardBox, w, h, live])
  const closeRef = useRef(close)
  useLayoutEffect(() => {
    closeRef.current = close
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
        } else void closeRef.current()
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
        void close()
        return
      }
      if (!typing && onStep && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        hideLive()
        onStep(e.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close, onStep, canEditUrl])

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
  const liveOnly = m.kind === 'video' || (m.kind === 'pdf' && !OWN_PDF_VIEWER)
  /** Show the live page. `to`: a tab just made for this card, not yet in its props. */
  const goLive = async (to?: number): Promise<void> => {
    autoLive.current = true
    if (liveRef.current !== 'off' && to === undefined) return
    const req = ++liveReq.current
    liveRef.current = 'loading'
    flushSync(() => setLive('loading'))
    await Promise.race([openDone.current, new Promise<void>((r) => setTimeout(r, 450))])
    if (req !== liveReq.current || closing.current) return
    await new Promise((r) => requestAnimationFrame(() => r(null))) // the slot is in place
    if (req !== liveReq.current || closing.current) return
    const r = slotBox(slot.current)
    if (!r) {
      liveRef.current = 'off'
      setLive('off')
      return
    }
    const id = await window.api.canvas.liveOpen({
      tab: to ?? tabRef.current ?? tab,
      url: to === undefined ? url : undefined,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    if (req !== liveReq.current || closing.current) {
      hideLive()
      return
    }
    if (id === null) {
      liveRef.current = 'off'
      setLive('off')
      return
    }
    tabRef.current = id
    if (tab === undefined && to === undefined) onTab(id)
    liveRef.current = 'on'
    setLive('on')
    const rNow = slotBox(slot.current)
    if (rNow && !addressOpenRef.current) window.api.canvas.liveMove(id, rNow)
    if (url) onLive?.(url, true)
  }
  const editAddress = async (): Promise<void> => {
    if (asking.current || !titleEl.current) return
    asking.current = true
    // the live page is a native view over the board and would hide the popover: it steps aside for its picture
    // while the popover is up (still live, not the reader), and comes back where it was
    await takeShot()
    flushSync(() => setAddressOpen(true))
    const text = await askSearch(anchorOver(titleEl.current), url ?? '')
    asking.current = false
    setAddressOpen(false)
    if (text) void submitUrl(text)
  }
  const submitUrl = async (input: string): Promise<void> => {
    const text = input.trim()
    if (!text || text === url) return
    const id = await window.api.canvas.navigate(tab ?? null, text)
    if (id === null) return
    if (tab === undefined) onTab(id)
    // the new page is shown as it loads; its words are read again when Reader is picked
    void goLive(id)
  }
  useLayoutEffect(() => {
    editRef.current = () => void editAddress()
  })
  // opened for the person by the assistant, or a video (it only plays in the page): once the panel has grown into
  // place, show the page itself
  const goLiveRef = useRef(goLive)
  useLayoutEffect(() => {
    goLiveRef.current = goLive
  })
  useEffect(() => {
    if (autoLive.current || (!startLive && !(liveOnly && canLive))) return
    // marked done only when it runs: a change meanwhile (the card's details settling) re-arms it, not cancels it
    const t = window.setTimeout(
      () => {
        if (autoLive.current) return
        autoLive.current = true
        void goLiveRef.current()
      },
      reduced ? 0 : 420
    )
    return () => window.clearTimeout(t)
  }, [startLive, reduced, liveOnly, canLive])
  // a page with no article to read (an app, a map) is a snapshot in the reader: it opens live instead
  useEffect(() => {
    if (!articleEmpty || live !== 'off' || !canLive || autoLive.current) return
    autoLive.current = true
    void goLiveRef.current()
  }, [articleEmpty, live, canLive])
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
    addressOpenRef.current = addressOpen
    if (live !== 'on') return
    if (addressOpen) hideLive()
    else placeLive()
  }, [addressOpen, live, hideLive, placeLive])
  // the zoom level shows in the bar while it is not the site's usual one
  useEffect(() => {
    if (live === 'on') readZoom()
  }, [live, readZoom])
  // (and when a split comes or goes: the slot is a new element then, at a new size)
  useEffect(() => {
    if (live !== 'on' || !slot.current) return
    const el = slot.current
    placeLive()
    const ro = new ResizeObserver(() => {
      const r = slotBox(el)
      if (r && tabRef.current !== null)
        window.api.canvas.liveMove(tabRef.current, {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height
        })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [live, splitKey, placeLive])

  // ---- a split view: the other panes, live beside this card's page ----
  const paneEls = useRef(new Map<number, HTMLDivElement>())
  const placeCompanions = useCallback((): void => {
    if (liveRef.current !== 'on' || addressOpenRef.current || closing.current) return
    const list: Array<{ id: number; rect: Rect }> = []
    for (const [id, el] of paneEls.current) {
      const r = slotBox(el)
      if (r) list.push({ id, rect: r })
    }
    window.api.canvas.liveCompanions?.(list)
  }, [])
  useEffect(() => {
    if (live !== 'on' || addressOpen || !splitKey) return
    placeCompanions()
    const ro = new ResizeObserver(placeCompanions)
    for (const el of paneEls.current.values()) ro.observe(el)
    return () => {
      ro.disconnect()
      window.api.canvas.liveCompanions?.([])
    }
  }, [live, addressOpen, splitKey, placeCompanions])
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
    else if (what === 'close') void close()
  }
  const pageMenu = (x: number, y: number): void => {
    const id = tabRef.current
    if (id === null || !window.api.pageMenu) return
    void window.api.pageMenu(id, x, y, canLive ? live === 'on' : undefined).then(onPagePick)
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
  ) : articleEmpty && m.snap ? (
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
    <div className="cv-expand" role="dialog" aria-modal="false" aria-label={m.title}>
      <div className="cv-scrim" ref={scrim} onPointerDown={() => void close()} />
      <div className="cv-panel" ref={panel} style={{ left, top, width: w, height: h }}>
        {/* one slim row: what it is on the left, how to see it in the middle, what to do with it on the right */}
        <header
          className="cv-panel-head"
          onContextMenu={(e) => {
            // the board's own menu would sit under the live page: the page's menu is a native one, over it
            e.preventDefault()
            e.stopPropagation()
            pageMenu(e.clientX, e.clientY)
          }}
        >
          <span className="cv-panel-icon" aria-hidden="true">
            <Favicon m={m} />
          </span>
          {live === 'on' && (
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
          {live === 'on' && caps.site && (
            <button
              type="button"
              ref={siteBtn}
              className="cv-hbtn cv-sitebtn"
              aria-label="Site settings"
              title="Site settings: permissions, blocker, data"
              onClick={openSite}
            >
              <SiteIcon />
            </button>
          )}
          <div className="cv-panel-title" title={m.title} ref={titleEl}>
            <strong>{m.title}</strong>
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
          {place && place.of > 1 && onStep ? (
            <div className="cv-step" role="group" aria-label="Cards in this section">
              <button
                type="button"
                aria-label="Previous card"
                title="Previous (Left arrow)"
                onClick={() => {
                  hideLive()
                  onStep(-1)
                }}
              >
                <PrevGlyph />
              </button>
              <span aria-live="polite">
                {place.at} / {place.of}
              </span>
              <button
                type="button"
                aria-label="Next card"
                title="Next (Right arrow)"
                onClick={() => {
                  hideLive()
                  onStep(1)
                }}
              >
                <NextGlyph />
              </button>
            </div>
          ) : null}
          {canLive && (m.kind === 'page' || m.kind === 'video') ? (
            <div className="cv-seg" role="radiogroup" aria-label="Show as">
              <button
                type="button"
                role="radio"
                aria-checked={live === 'off'}
                className={live === 'off' ? 'on' : ''}
                onClick={toReader}
              >
                Reader
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={live !== 'off'}
                className={live !== 'off' ? 'on' : ''}
                title="The real page, which you can use"
                onClick={() => void goLive()}
              >
                Live
              </button>
            </div>
          ) : (
            canLive && (
              <button
                type="button"
                className={'cv-pill' + (live !== 'off' ? ' on' : '')}
                onClick={() => (live === 'off' ? void goLive() : toReader())}
                aria-pressed={live !== 'off'}
              >
                <LiveIcon />
                {live === 'off' ? 'Open live' : 'Back to reader'}
              </button>
            )
          )}
          <div className="cv-hacts">
            {m.isTab ||
            tab !== undefined ||
            m.kind === 'page' ||
            m.kind === 'video' ||
            /^(https?|file):/i.test(url ?? '') ? (
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
            {/* always there for a tab, so the bar never shifts as sound starts and stops; quiet while silent (muting
                a silent page still holds: it stays quiet when it starts) */}
            {m.isTab ? (
              <button
                type="button"
                className={
                  'cv-hbtn' + (m.muted ? ' on' : '') + (!m.audible && !m.muted ? ' quiet' : '')
                }
                aria-label={m.muted ? 'Unmute' : 'Mute'}
                title={m.muted ? 'Unmute' : m.audible ? 'Mute' : 'Mute (nothing is playing)'}
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
            {live === 'on' && (
              <button
                type="button"
                className={'cv-hbtn' + (findKey !== null ? ' on' : '')}
                aria-label="Find in page"
                title="Find in page (Ctrl+F)"
                onClick={openFind}
              >
                <SearchIcon />
              </button>
            )}
            {caps.bookmark && page ? (
              <button
                type="button"
                className={'cv-hbtn' + (page.bookmarked ? ' on' : '')}
                aria-label={page.bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
                aria-pressed={page.bookmarked}
                title={page.bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'}
                onClick={() => window.api.toggleBookmark()}
              >
                <StarIcon filled={page.bookmarked} />
              </button>
            ) : null}
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
            {tab !== undefined && (
              <button
                type="button"
                className="cv-hbtn"
                aria-label="More"
                aria-haspopup="menu"
                title="More: zoom, site settings, page source..."
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  pageMenu(r.left, r.bottom + 4)
                }}
              >
                <MoreIcon />
              </button>
            )}
            {/* back down into its card on the board (the page stays open as a tab): an arrow down, not a close */}
            <button
              type="button"
              className="cv-hbtn"
              aria-label="Back to the board"
              title="Back to the board (Esc)"
              onClick={() => void close()}
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
                    {/* always under the native view: whenever it is away (moving, a popover over it, closing), the
                      page is still there in picture, never an empty slot */}
                    {live === 'on' && (shot ?? m.snap) && (
                      <img src={shot ?? m.snap} alt="" draggable={false} />
                    )}
                    {live === 'loading' && (
                      <>
                        {m.snap && <img src={m.snap} alt="" draggable={false} />}
                        <span className="cv-live-bar" />
                      </>
                    )}
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
                          {p.snap && <img src={p.snap} alt="" draggable={false} />}
                        </div>
                      )
                    )}
                  </div>
                )
              })()}
        </div>
      </div>
    </div>
  )
}
