import { Favicon, Img } from './Img'
import { animate } from 'motion'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { parseMarkdown, type Block, type Inline } from '@shared/ai/markdown'
import type { CanvasReaderDoc } from '@shared/ai/canvasItems'
import type { CardModel } from './model'
import { LiveIcon } from './icons'
import { openPdf, pinPdf, unpinPdf } from './pdf'
import { anchorOver, askSearch } from './askSearch'

const SPRING = { type: 'spring', stiffness: 300, damping: 31, mass: 0.9 } as const
const READ_W = 1280
/** Room kept under the panel for the canvas toolbar, which stays above it. */
const TOOLBAR_GAP = 84
/** PDF pages stop growing here: wider than this they read worse, and Ctrl+wheel zooms past it. */
const PDF_W = 940

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
  onClose: () => void
  onGoToTab: () => void
  /** A tab was made for the live page: the card should remember it. */
  onTab: (tab: number) => void
  /** The text of a note was edited. */
  onText?: (text: string) => void
  /** The previous or next card of the same section (arrow keys). */
  onStep?: (dir: -1 | 1) => void
  /** Open straight onto the live page (something the assistant just opened for the person). */
  startLive?: boolean
  /**
   * The sidebar or top bar is out over the board (it slides and blurs the board). The live page is a native view
   * that cannot slide or blur with it, so it steps aside for its picture until the chrome is gone.
   */
  covered?: boolean
  /** The live tab can go back or forward (its history). */
  canBack?: boolean
  canForward?: boolean
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
const CloseGlyph = (): React.JSX.Element => <Glyph d="m4.5 4.5 7 7m0-7-7 7" />
const PrevGlyph = (): React.JSX.Element => <Glyph d="M9.8 3.6 5.4 8l4.4 4.4" />
const NextGlyph = (): React.JSX.Element => <Glyph d="M6.2 3.6 10.6 8l-4.4 4.4" />
const ReloadGlyph = (): React.JSX.Element => (
  <Glyph d="M12.6 8a4.6 4.6 0 1 1-1.4-3.3M12.4 2.6v2.3H10.1" />
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
  width
}: {
  src: { url?: string; file?: string }
  width: number
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
  }, [src.url, src.file])
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
 * from its card) does not shrink it. A native view sized from the animated box stays small once it ends.
 */
function slotBox(
  el: HTMLElement | null
): { x: number; y: number; width: number; height: number } | null {
  const root = el?.closest<HTMLElement>('.cv-expand')
  if (!el || !root) return null
  let x = 0
  let y = 0
  for (let n: HTMLElement | null = el; n && n !== root; n = n.offsetParent as HTMLElement | null) {
    x += n.offsetLeft
    y += n.offsetTop
  }
  const r = root.getBoundingClientRect()
  return { x: r.x + x, y: r.y + y, width: el.offsetWidth, height: el.offsetHeight }
}

/**
 * A card opened to reading size, on the board. It grows out of the card with a spring (transform and opacity
 * only) and goes back into it. PDFs, pictures, articles and answers are drawn here; a full page can be shown live,
 * as the one real browser view placed exactly over the body (never scaled, never moved by a transform).
 */
export function Expanded({
  m,
  from,
  stage,
  tab,
  url,
  file,
  reduced,
  answerLinks,
  onClose,
  onGoToTab,
  onTab,
  onText,
  onStep,
  place,
  covered = false,
  canBack = false,
  canForward = false,
  startLive = false
}: Props): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  const [live, setLive] = useState<'off' | 'loading' | 'on'>('off')
  const [articleEmpty, setArticleEmpty] = useState(false)
  // the address: the site name (or Ctrl+L) opens the address bar's search popover over the header
  const titleEl = useRef<HTMLDivElement>(null)
  const asking = useRef(false)
  const canEditUrl = (m.kind === 'page' || m.kind === 'video') && (tab !== undefined || !!url)
  const editRef = useRef<() => void>(() => undefined)
  const toReader = (): void => {
    if (live === 'off') return
    hideLive()
    setLive('off')
  }
  // as much of the board as it can take: a thin margin round it, and the toolbar left clear below
  const w = Math.min(READ_W, stage.w - 48)
  const top = 16
  const h = Math.max(320, stage.h - top - TOOLBAR_GAP)
  const left = Math.round((stage.w - w) / 2)
  const fromTf = `translate(${from.x - left}px, ${from.y - top}px) scale(${from.w / w}, ${from.h / h})`

  useLayoutEffect(() => {
    if (reduced || !panel.current) return
    panel.current.style.transformOrigin = '0 0'
    // the live page is a native view and cannot grow with the panel: it waits for this (see goLive)
    openDone.current = animate(
      panel.current,
      { transform: [fromTf, 'translate(0px, 0px) scale(1, 1)'] },
      SPRING
    ).finished.then(
      () => undefined,
      () => undefined
    )
    if (scrim.current) void animate(scrim.current, { opacity: [0, 1] }, { duration: 0.22 })
    if (body.current)
      void animate(body.current, { opacity: [0, 1] }, { duration: 0.2, delay: 0.12 })
    // runs once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openDone = useRef<Promise<void>>(Promise.resolve())
  // closing with the live page up: the slot shows its picture, which shrinks with the panel
  const [shrinking, setShrinking] = useState(false)
  const hideLive = useCallback((): void => {
    window.api.canvas.liveHide()
  }, [])
  useEffect(() => () => hideLive(), [hideLive])

  const close = useCallback(async (): Promise<void> => {
    if (closing.current) return
    closing.current = true
    if (live !== 'off') flushSync(() => setShrinking(true))
    hideLive()
    if (!reduced && panel.current) {
      if (body.current && live === 'off')
        void animate(body.current, { opacity: 0 }, { duration: 0.1 })
      if (scrim.current) void animate(scrim.current, { opacity: 0 }, { duration: 0.2 })
      await animate(
        panel.current,
        { transform: ['translate(0px, 0px) scale(1, 1)', fromTf] },
        { type: 'spring', stiffness: 340, damping: 34 }
      ).finished
    }
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideLive, reduced, onClose, fromTf, live, setShrinking])

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      // the search popover is open over the preview: its keys are its own
      if (asking.current || (e.target instanceof Element && e.target.closest('.pal'))) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l' && canEditUrl) {
        e.preventDefault()
        e.stopPropagation()
        editRef.current()
        return
      }
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
    if (!url) return
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }

  const canLive = (m.kind === 'page' || m.kind === 'video') && (tab !== undefined || !!url)
  /** Show the live page (or go back to the words). `to`: a tab just made for this card, not yet in its props. */
  const goLive = async (to?: number): Promise<void> => {
    if (live !== 'off' && to === undefined) {
      hideLive()
      setLive('off')
      return
    }
    setLive('loading')
    await new Promise((r) => requestAnimationFrame(() => r(null))) // the slot is in place
    await openDone.current // and the panel has finished growing (the page cannot grow with it)
    const r = slotBox(slot.current)
    if (!r) return setLive('off')
    const id = await window.api.canvas.liveOpen({
      tab: to ?? tab,
      url: to === undefined ? url : undefined,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    if (id === null) return setLive('off')
    if (tab === undefined && to === undefined) onTab(id)
    setLive('on')
  }
  const editAddress = async (): Promise<void> => {
    if (asking.current || !titleEl.current) return
    asking.current = true
    // the live page is a native view over the board: it would hide the popover
    const wasLive = live !== 'off'
    if (wasLive) {
      hideLive()
      setLive('off')
    }
    const text = await askSearch(anchorOver(titleEl.current), url ?? '')
    asking.current = false
    if (text) void submitUrl(text)
    else if (wasLive) void goLive()
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
  const autoLive = useRef(false)
  useLayoutEffect(() => {
    goLiveRef.current = goLive
  })
  useEffect(() => {
    if (autoLive.current || (!startLive && !(m.kind === 'video' && canLive))) return
    autoLive.current = true
    const t = window.setTimeout(() => void goLiveRef.current(), reduced ? 0 : 420)
    return () => window.clearTimeout(t)
  }, [startLive, reduced, m.kind, canLive])
  // a page with no article to read (an app, a map) is a snapshot in the reader: it opens live instead
  useEffect(() => {
    if (!articleEmpty || live !== 'off' || !canLive || autoLive.current) return
    autoLive.current = true
    void goLiveRef.current()
  }, [articleEmpty, live, canLive])
  // the live page follows the slot if the window is resized
  const tabRef = useRef<number | null>(tab ?? null)
  useEffect(() => {
    tabRef.current = tab ?? tabRef.current
  }, [tab])
  // chrome brought out over the board: the live page steps aside for its picture, and comes back where the slot is
  useEffect(() => {
    if (live !== 'on') return
    if (covered) {
      hideLive()
      return
    }
    const r = slotBox(slot.current)
    const id = tabRef.current
    if (r && id !== null)
      window.api.canvas.liveMove(id, { x: r.x, y: r.y, width: r.width, height: r.height })
  }, [covered, live, hideLive])
  useEffect(() => {
    if (live !== 'on' || !slot.current) return
    const el = slot.current
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
  }, [live])

  const src = m.pdf ?? { url, file }
  const bodyView =
    m.kind === 'pdf' ? (
      <PdfReader src={src} width={Math.min(PDF_W, w - 48)} />
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
        <header className="cv-panel-head">
          <span className="cv-panel-icon" aria-hidden="true">
            <Favicon m={m} />
          </span>
          {live === 'on' && (
            <div className="cv-nav" role="group" aria-label="Page navigation">
              <button
                type="button"
                aria-label="Back"
                title="Back"
                disabled={!canBack}
                onClick={() =>
                  tabRef.current !== null && window.api.canvas.liveNav(tabRef.current, 'back')
                }
              >
                <PrevGlyph />
              </button>
              <button
                type="button"
                aria-label="Forward"
                title="Forward"
                disabled={!canForward}
                onClick={() =>
                  tabRef.current !== null && window.api.canvas.liveNav(tabRef.current, 'forward')
                }
              >
                <NextGlyph />
              </button>
              <button
                type="button"
                aria-label="Reload"
                title="Reload"
                onClick={() =>
                  tabRef.current !== null && window.api.canvas.liveNav(tabRef.current, 'reload')
                }
              >
                <ReloadGlyph />
              </button>
            </div>
          )}
          <div className="cv-panel-title" title={m.title} ref={titleEl}>
            <strong>{m.title}</strong>
            {canEditUrl ? (
              <button
                type="button"
                className="cv-panel-site"
                title={`${url ?? m.site} (Ctrl+L to change)`}
                onClick={() => void editAddress()}
              >
                {m.site || url}
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
          {canLive && m.kind === 'page' ? (
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
                onClick={() => live === 'off' && void goLive()}
              >
                Live
              </button>
            </div>
          ) : (
            canLive && (
              <button
                type="button"
                className={'cv-pill' + (live !== 'off' ? ' on' : '')}
                onClick={() => void goLive()}
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
            {url && /^https?:/i.test(url) ? (
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
            <button
              type="button"
              className="cv-hbtn"
              aria-label="Close"
              title="Close (Esc)"
              onClick={() => void close()}
            >
              <CloseGlyph />
            </button>
          </div>
        </header>
        <div className="cv-panel-body" ref={body}>
          {live === 'off' ? (
            bodyView
          ) : (
            <div className="cv-live-slot" ref={slot}>
              {live === 'on' && (covered || shrinking) && m.snap && (
                <img src={m.snap} alt="" draggable={false} />
              )}
              {live === 'loading' && (
                <>
                  {m.snap && <img src={m.snap} alt="" draggable={false} />}
                  <span className="cv-live-bar" />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
