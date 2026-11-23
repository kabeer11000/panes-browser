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
import type { Person } from './room'

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

export function Board({
  state,
  people,
  onEdit,
  onPoint
}: {
  state: CanvasState
  people: Person[]
  onEdit: (fn: (s: CanvasState) => CanvasState) => void
  onPoint: (at: { x: number; y: number } | null) => void
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 1 })
  const viewRef = useRef(view)
  useLayoutEffect(() => {
    viewRef.current = view
  })
  const fitted = useRef(false)
  const [editing, setEditing] = useState<string | null>(null)

  // the first time there is something to show: all of it in view
  useLayoutEffect(() => {
    if (fitted.current || !host.current) return
    const b = boundsOf(state)
    if (!b) return
    fitted.current = true
    const r = host.current.getBoundingClientRect()
    const k = Math.min(1, (r.width - 80) / b.w, (r.height - 160) / b.h)
    setView({
      k,
      x: r.width / 2 - (b.x + b.w / 2) * k,
      y: r.height / 2 + 30 - (b.y + b.h / 2) * k
    })
  }, [state])

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
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        onPoint(toBoard(e))
        const d = drag.current
        if (d) setView({ ...viewRef.current, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })
      }}
      onPointerUp={() => (drag.current = null)}
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
              <svg key={m.id} className="wb-mark" style={style} overflow="visible">
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
              <svg key={m.id} className="wb-mark" style={style} overflow="visible">
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
          const title = item?.title || c.url
          return (
            <a
              key={c.id}
              className="wb-card"
              href={c.url || item?.url || undefined}
              target="_blank"
              rel="noopener noreferrer"
              draggable={false}
              style={{ left: c.x, top: c.y, width: c.w ?? CARD_W, height: c.h ?? CARD_H }}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {item?.image ? (
                <img src={item.image} alt="" draggable={false} />
              ) : (
                <div className="wb-card-text">{item?.text?.slice(0, 400)}</div>
              )}
              <footer>
                <b>{title}</b>
                <span>{item?.site}</span>
              </footer>
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
    </div>
  )
}
