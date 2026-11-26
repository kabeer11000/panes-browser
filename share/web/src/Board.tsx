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

/** Panes' drawing colours: canvas.css --m0..--m7, set in web.css for both schemes. */
const markColor = (i: number): string => `var(--m${((i % 8) + 8) % 8})`

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

/** What a card shows, as Panes draws it: a page's picture in its frame, its words, or a tile with who it is. */
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
  const site = sealed
    ? 'Shared file'
    : item?.site || (url ? new URL(url).host.replace(/^www\./, '') : '')
  const title = item?.title || site || 'Untitled'
  const letter = sealed
    ? sealed.ext.slice(1, 5).toUpperCase()
    : (siteName(site) || title).slice(0, 1).toUpperCase()
  const hue = siteHue(site || title)
  const icon = (
    <span className="wb-icon" style={{ '--hue': hue } as React.CSSProperties} aria-hidden="true">
      {letter}
    </span>
  )
  const tab = item?.source === 'tab' && <span className="wb-tabtag">Tab</span>
  if (picture && !broken)
    return (
      <div className={'wb-snap' + (item?.kind === 'image' || sealed ? ' whole' : '')}>
        <img
          src={picture}
          alt=""
          draggable={false}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
        <div className="wb-snap-foot">
          {icon}
          <b>{title}</b>
        </div>
        {tab}
      </div>
    )
  if (item?.text)
    return (
      <div className="wb-doc">
        <span className="wb-site">
          {icon}
          {site}
        </span>
        <h3>{title}</h3>
        <p>{item.text.slice(0, 600)}</p>
        {tab}
      </div>
    )
  return (
    <div className="wb-ph">
      <span
        className={'wb-ph-icon' + (sealed ? ' ext' : '')}
        style={{ '--hue': hue } as React.CSSProperties}
      >
        {letter}
      </span>
      <h3>{title}</h3>
      <small>{site}</small>
      {tab}
    </div>
  )
}

/** The board's bar at the bottom, as in Panes: a new note, and the zoom (out, the zoom itself, in, everything). */
function BoardBar({
  k,
  onZoom,
  onFit,
  onNote
}: {
  k: number
  onZoom: (k: number) => void
  onFit: () => void
  onNote: () => void
}): React.JSX.Element {
  const stop = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation()
  }
  return (
    <div className="wb-bar" {...stop}>
      <button
        type="button"
        className="wb-tool"
        title="New note (or double-click the board)"
        aria-label="New note"
        onClick={onNote}
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 4h14v10l-6 6H5z" />
          <path d="M13 20v-6h6" />
        </svg>
      </button>
      <span className="wb-sep" aria-hidden="true" />
      <button
        type="button"
        className="wb-tool"
        title="Zoom out"
        aria-label="Zoom out"
        onClick={() => onZoom(k / 1.25)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className="wb-zoomk" title="Back to 100%" onClick={() => onZoom(1)}>
        {Math.round(k * 100)}%
      </button>
      <button
        type="button"
        className="wb-tool"
        title="Zoom in"
        aria-label="Zoom in"
        onClick={() => onZoom(k * 1.25)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3.5 8h9M8 3.5v9"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="wb-tool"
        title="Show everything"
        aria-label="Show everything"
        onClick={onFit}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"
            stroke="currentColor"
            strokeWidth="1.5"
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
            className={'wb-frame' + (f.color !== undefined ? ` fc${f.color % 7}` : '')}
            style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
          >
            <div className="wb-frame-head">
              <span className="wb-frame-name">{f.name}</span>
            </div>
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
                  style={{ stroke: markColor(m.color) }}
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
                  style={{
                    fill: m.fill !== undefined && m.fill >= 0 ? markColor(m.fill) : 'none',
                    stroke: m.stroke === false ? 'none' : markColor(m.color)
                  }}
                  fillOpacity={0.25}
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
                <svg width="16" height="20" viewBox="0 0 16 20">
                  <path d="M1 1 L1 16 L5 12 L8 19 L11 17.6 L8 11 L14 11 Z" />
                </svg>
                <span>{p.name}</span>
              </div>
            )
        )}
      </div>
      <BoardBar
        k={view.k}
        onZoom={zoomTo}
        onFit={() => fit(state)}
        onNote={() => {
          const r = host.current!.getBoundingClientRect()
          const v = viewRef.current
          const at = { x: (r.width / 2 - v.x) / v.k, y: (r.height / 2 - v.y) / v.k }
          let made = ''
          onEdit((st) => {
            const n = addNote(st, { x: at.x - NOTE_W / 2, y: at.y - NOTE_H / 2 }, st.notes.length)
            made = n.id
            return n.state
          })
          if (made) setEditing(made)
        }}
      />
    </div>
  )
}
