import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  addNote,
  CARD_H,
  CARD_W,
  NOTE_H,
  NOTE_W,
  type CanvasState,
  type Viewport
} from '@shared/ai/canvas'
import { isShape, shapePath, type ShapeKind } from '@shared/ai/canvasMarks'
import { parseInline } from '@shared/noteMarks'
import type { CanvasItem } from '@shared/ai/canvasItems'
import { parseSealed } from '@shared/share/doc'
import type { Person } from './room'

/** Only web addresses are followed or shown: a card from the room may name a file of someone's computer. */
const webOnly = (url: string | undefined, picture = false): string | undefined =>
  url && (/^https?:/i.test(url) || (picture && /^data:image\//i.test(url))) ? url : undefined

/**
 * The board, from the web: the room's sections, cards, notes and marks, live, with everyone's pointers. Pan by
 * dragging the empty board (or scrolling), zoom with Ctrl+scroll or a pinch. Notes are the one thing made here:
 * double-click the board for a new one, a note to write in it. The rest is shown as Panes made it.
 */

const MARK_COLORS = [
  '#1f2328',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#ec4899'
]
const markColor = (i: number): string => MARK_COLORS[((i % 8) + 8) % 8]

function boundsOf(s: CanvasState): { x: number; y: number; w: number; h: number } | null {
  const boxes = [
    ...s.frames,
    ...s.notes,
    ...s.cards.map((c) => ({ x: c.x, y: c.y, w: c.w ?? CARD_W, h: c.h ?? CARD_H })),
    ...(s.marks ?? [])
  ]
  if (boxes.length === 0) return null
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y)) - 40 // section titles sit above
  const r = Math.max(...boxes.map((b) => b.x + b.w))
  const b = Math.max(...boxes.map((b) => b.y + b.h))
  return { x, y, w: r - x, h: b - y }
}

function Note({
  id,
  text,
  color,
  editing,
  onEdit,
  onDone
}: {
  id: string
  text: string
  color: number
  editing: boolean
  onEdit: (id: string) => void
  onDone: (id: string, text: string) => void
}): React.JSX.Element {
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!editing) return
    const a = area.current
    a?.focus()
    a?.setSelectionRange(a.value.length, a.value.length)
  }, [editing])
  return (
    <div
      className={`wb-note c${((color % 6) + 6) % 6}`}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onEdit(id)
      }}
    >
      {editing ? (
        <textarea
          ref={area}
          defaultValue={text}
          maxLength={600}
          aria-label="Note"
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => onDone(id, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.blur()
          }}
        />
      ) : (
        <p>
          {parseInline(text).map((r, i) => {
            let el: React.ReactNode = r.t
            if (r.s) el = <s>{el}</s>
            if (r.i) el = <em>{el}</em>
            if (r.b) el = <strong>{el}</strong>
            return <span key={i}>{el}</span>
          })}
        </p>
      )}
    </div>
  )
}

/** A site's own name for its letter: "wikipedia" for en.wikipedia.org, "bbc" for www.bbc.co.uk. */
function siteName(site: string): string {
  const parts = site.split('.').filter(Boolean)
  if (parts.length < 2) return site
  const tail = parts.at(-2)!
  // a two-part ending (co.uk, com.pk): the name is the part before it
  return tail.length <= 3 && parts.length > 2 ? parts.at(-3)! : tail
}

/** A site's colour for its tile: the same site, the same colour on every board. */
function siteHue(site: string): number {
  let h = 0
  for (const ch of site) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 360
}

/** What a card shows: a page's picture, a shared picture opened here, its text, or a tile for the site or file. */
function Card({
  url,
  item,
  fileOf
}: {
  url: string | undefined
  item: CanvasItem | undefined
  fileOf: (sealed: string) => string | undefined
}): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  const sealed = item?.sealed ? parseSealed(item.sealed) : null
  const picture =
    (item?.sealed ? fileOf(item.sealed) : undefined) ??
    webOnly(item?.image, true) ??
    (item?.kind === 'image' ? webOnly(item.url) : undefined)
  const site = item?.site || (url ? new URL(url).host.replace(/^www\./, '') : '')
  const title = item?.title || site || 'Untitled'
  const letter = (siteName(site) || title).slice(0, 1).toUpperCase()
  const tab = item?.source === 'tab'
  const tile = (
    <div
      className={'wb-card-tile' + (item?.text ? ' text' : '')}
      style={{ '--hue': siteHue(site || title) } as React.CSSProperties}
    >
      {item?.text ? (
        <p>{item.text.slice(0, 420)}</p>
      ) : sealed ? (
        <span className="wb-card-ext">{sealed.ext.slice(1).toUpperCase()}</span>
      ) : (
        <span className="wb-card-letter">{letter}</span>
      )}
    </div>
  )
  return (
    <>
      <div className="wb-card-pic">
        {picture && !broken ? (
          <img
            src={picture}
            alt=""
            draggable={false}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
          />
        ) : (
          tile
        )}
        {tab && <span className="wb-card-badge">Tab</span>}
      </div>
      <footer>
        <span
          className="wb-card-fav"
          style={{ '--hue': siteHue(site || title) } as React.CSSProperties}
          aria-hidden="true"
        >
          {letter}
        </span>
        <span className="wb-card-words">
          <b>{title}</b>
          <span>{sealed ? 'Shared file' : site}</span>
        </span>
      </footer>
    </>
  )
}

/** The zoom buttons in the corner: out, the zoom (click: back to 100%), in, and fit everything. */
function ZoomBar({
  k,
  onZoom,
  onFit
}: {
  k: number
  onZoom: (k: number) => void
  onFit: () => void
}): React.JSX.Element {
  return (
    <div
      className="wb-zoom"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => onZoom(k / 1.25)}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3 7h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className="wb-zoom-k" title="Back to 100%" onClick={() => onZoom(1)}>
        {Math.round(k * 100)}%
      </button>
      <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => onZoom(k * 1.25)}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3 7h8M7 3v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" aria-label="Show everything" title="Show everything" onClick={onFit}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}

export function Board({
  state,
  people,
  onEdit,
  onPoint,
  fileOf
}: {
  state: CanvasState
  people: Person[]
  onEdit: (fn: (s: CanvasState) => CanvasState) => void
  onPoint: (at: { x: number; y: number } | null) => void
  /** A shared picture opened here (room.ts), once it has come. */
  fileOf: (sealed: string) => string | undefined
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 1 })
  const viewRef = useRef(view)
  useLayoutEffect(() => {
    viewRef.current = view
  })
  const fitted = useRef(false)
  const [editing, setEditing] = useState<string | null>(null)

  /** Everything on the board in view, under the top bar (no bigger than 100%). */
  const fit = (s: CanvasState): boolean => {
    const b = boundsOf(s)
    if (!b || !host.current) return false
    const r = host.current.getBoundingClientRect()
    const k = Math.max(0.1, Math.min(1, (r.width - 80) / b.w, (r.height - 160) / b.h))
    setView({
      k,
      x: r.width / 2 - (b.x + b.w / 2) * k,
      y: r.height / 2 + 30 - (b.y + b.h / 2) * k
    })
    return true
  }
  // the first time there is something to show: all of it in view
  useLayoutEffect(() => {
    if (fitted.current) return
    if (fit(state)) fitted.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the board first has something
  }, [state])
  /** Zoom to `k` about the middle of the window. */
  const zoomTo = (k: number): void => {
    const el = host.current
    if (!el) return
    const v = viewRef.current
    const nk = Math.min(3, Math.max(0.1, k))
    const r = el.getBoundingClientRect()
    const px = r.width / 2
    const py = r.height / 2
    setView({ k: nk, x: px - ((px - v.x) / v.k) * nk, y: py - ((py - v.y) / v.k) * nk })
  }
  /** Fingers on the board (touch): one pans, two pinch to zoom about their middle. */
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{
    d: number
    k: number
    mx: number
    my: number
    vx: number
    vy: number
  } | null>(null)

  // scroll pans, Ctrl+scroll (and a touchpad pinch) zooms about the pointer
  useEffect(() => {
    const el = host.current
    if (!el) return
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      const v = viewRef.current
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect()
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        const k = Math.min(3, Math.max(0.1, v.k * Math.exp(-e.deltaY * 0.01)))
        setView({ k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k })
      } else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  const toBoard = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = host.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k }
  }
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  const commit = (id: string, text: string): void => {
    setEditing(null)
    onEdit((s) => {
      const n = s.notes.find((x) => x.id === id)
      if (!n) return s
      // a new note left empty is not kept
      if (!text.trim() && !n.text) return { ...s, notes: s.notes.filter((x) => x.id !== id) }
      return n.text === text
        ? s
        : { ...s, notes: s.notes.map((x) => (x.id === id ? { ...x, text } : x)) }
    })
  }

  return (
    <div
      ref={host}
      className="wb-board"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        if (e.pointerType === 'touch') {
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (touches.current.size === 2) {
            const [a, b] = [...touches.current.values()]
            const v = viewRef.current
            drag.current = null
            pinch.current = {
              d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
              k: v.k,
              mx: (a.x + b.x) / 2,
              my: (a.y + b.y) / 2,
              vx: v.x,
              vy: v.y
            }
            return
          }
        }
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
      }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'touch') onPoint(toBoard(e))
        if (touches.current.has(e.pointerId))
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const p = pinch.current
        if (p && touches.current.size === 2) {
          const [a, b] = [...touches.current.values()]
          const r = host.current!.getBoundingClientRect()
          const k = Math.min(3, Math.max(0.1, (p.k * Math.hypot(a.x - b.x, a.y - b.y)) / p.d))
          const mx = (a.x + b.x) / 2
          const my = (a.y + b.y) / 2
          // the board point under the fingers' first middle stays under their middle now
          const wx = (p.mx - r.left - p.vx) / p.k
          const wy = (p.my - r.top - p.vy) / p.k
          setView({ k, x: mx - r.left - wx * k, y: my - r.top - wy * k })
          return
        }
        const d = drag.current
        if (d) setView({ ...viewRef.current, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })
      }}
      onPointerUp={(e) => {
        touches.current.delete(e.pointerId)
        if (touches.current.size < 2) pinch.current = null
        drag.current = null
      }}
      onPointerCancel={(e) => {
        touches.current.delete(e.pointerId)
        pinch.current = null
        drag.current = null
      }}
      onPointerLeave={() => onPoint(null)}
      onDoubleClick={(e) => {
        const at = toBoard(e)
        let made = ''
        onEdit((s) => {
          const r = addNote(s, { x: at.x - NOTE_W / 2, y: at.y - NOTE_H / 2 }, s.notes.length)
          made = r.id
          return r.state
        })
        if (made) setEditing(made)
      }}
    >
      <div
        className="wb-world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        {state.frames.map((f) => (
          <section
            key={f.id}
            className={`wb-frame f${f.color ?? 0}`}
            style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
          >
            <h2>{f.name}</h2>
          </section>
        ))}
        {(state.marks ?? []).map((m) => {
          const style = {
            left: m.x,
            top: m.y,
            width: m.w,
            height: m.h,
            transform: m.rot ? `rotate(${m.rot}deg)` : undefined
          }
          if (m.kind === 'pen' || m.kind === 'marker') {
            const pts = m.pts ?? []
            const d = pts.reduce(
              (acc, v, i) =>
                i % 2 === 0 ? `${acc}${i ? 'L' : 'M'}${v - m.x} ` : `${acc}${v - m.y} `,
              ''
            )
            return (
              <svg key={m.id} className="wb-draw" style={style} overflow="visible">
                <path
                  d={d}
                  fill="none"
                  stroke={markColor(m.color)}
                  strokeWidth={m.kind === 'marker' ? 14 : 3}
                  strokeOpacity={m.kind === 'marker' ? 0.4 : 1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )
          }
          if (isShape(m.kind))
            return (
              <svg key={m.id} className="wb-draw" style={style} overflow="visible">
                <path
                  d={shapePath(m.kind as ShapeKind, m.w, m.h)}
                  fill={m.fill !== undefined && m.fill >= 0 ? markColor(m.fill) : 'none'}
                  fillOpacity={0.25}
                  stroke={m.stroke === false ? 'none' : markColor(m.color)}
                  strokeWidth={2}
                />
                {m.text && (
                  <foreignObject width={m.w} height={m.h}>
                    <div className="wb-shape-text">{m.text}</div>
                  </foreignObject>
                )}
              </svg>
            )
          return (
            <div
              key={m.id}
              className={'wb-text' + (m.kind === 'text' ? '' : ' block')}
              style={{
                ...style,
                fontSize: m.size ?? 20,
                color: m.kind === 'text' ? markColor(m.color) : undefined
              }}
            >
              {m.text}
            </div>
          )
        })}
        {state.cards.map((c) => {
          const item = state.items[String(c.id)]
          const href = webOnly(c.url || item?.url)
          return (
            <a
              key={c.id}
              className="wb-card"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              draggable={false}
              style={{ left: c.x, top: c.y, width: c.w ?? CARD_W, height: c.h ?? CARD_H }}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <Card url={href} item={item} fileOf={fileOf} />
            </a>
          )
        })}
        {state.notes.map((n) => (
          <div
            key={n.id}
            className="wb-note-at"
            style={{ left: n.x, top: n.y, width: n.w, minHeight: n.h }}
            onPointerDown={(e) => editing === n.id && e.stopPropagation()}
          >
            <Note
              id={n.id}
              text={n.text}
              color={n.color}
              editing={editing === n.id}
              onEdit={setEditing}
              onDone={commit}
            />
          </div>
        ))}
        {people.map(
          (p) =>
            p.cursor && (
              <div
                key={p.id}
                className="wb-cursor"
                style={
                  {
                    transform: `translate(${p.cursor.x}px, ${p.cursor.y}px) scale(${1 / view.k})`,
                    '--pc': p.color
                  } as React.CSSProperties
                }
                aria-hidden="true"
              >
                <svg width="18" height="20" viewBox="0 0 16 18">
                  <path d="M1 1l13 7.5-6 1.2L5.2 16z" />
                </svg>
                <span>{p.name}</span>
              </div>
            )
        )}
      </div>
      <ZoomBar k={view.k} onZoom={zoomTo} onFit={() => fit(state)} />
    </div>
  )
}
