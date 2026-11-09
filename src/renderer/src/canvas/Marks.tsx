import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  BLOCK_ROW,
  checkLines,
  HEADING_MIN,
  isBlock,
  isShape,
  parseTable,
  shapePath,
  tableText,
  type CanvasMark,
  type ShapeKind
} from '@shared/ai/canvasMarks'
import { heightFor, textInset } from '@shared/ai/canvasText'

const col = (c: number): string => `var(--m${((c % 8) + 8) % 8})`
const fillOf = (m: CanvasMark): string =>
  m.fill === undefined || m.fill < 0
    ? 'none'
    : `color-mix(in srgb, ${col(m.fill)} 26%, transparent)`
const sizeOf = (m: CanvasMark): number =>
  m.size ?? (m.kind === 'text' ? 20 : isBlock(m.kind) ? 14 : 16)

/** The points of a line as a smooth SVG path (midpoints between points, so a hand-drawn line is not jagged). */
function linePath(p: number[]): string {
  if (p.length < 4) return ''
  let d = `M${p[0]} ${p[1]}`
  for (let i = 2; i < p.length - 2; i += 2) {
    d += `Q${p[i]} ${p[i + 1]} ${(p[i] + p[i + 2]) / 2} ${(p[i + 1] + p[i + 3]) / 2}`
  }
  return d + `L${p[p.length - 2]} ${p[p.length - 1]}`
}

function Body({ m }: { m: CanvasMark }): React.JSX.Element {
  const stroke = m.stroke === false ? 'none' : col(m.color)
  const common = {
    fill: fillOf(m),
    stroke,
    strokeWidth: 2.5,
    vectorEffect: 'non-scaling-stroke' as const
  }
  if (m.kind === 'rect' || m.kind === 'rounded')
    return (
      <rect
        width={m.w}
        height={m.h}
        rx={m.kind === 'rounded' ? Math.min(24, m.h / 3) : 2}
        {...common}
      />
    )
  if (m.kind === 'ellipse')
    return <ellipse cx={m.w / 2} cy={m.h / 2} rx={m.w / 2} ry={m.h / 2} {...common} />
  return (
    <path
      d={isShape(m.kind) ? shapePath(m.kind, m.w, m.h) : ''}
      strokeLinejoin="round"
      {...common}
    />
  )
}

/** A table, checklist or code block as it reads on the board. */
function BlockView({
  m,
  onToggle
}: {
  m: CanvasMark
  onToggle: (id: string, line: number) => void
}): React.JSX.Element {
  const k = sizeOf(m) / 14
  const style = { fontSize: sizeOf(m), '--mc': col(m.color) } as React.CSSProperties
  if (m.kind === 'table') {
    const rows = parseTable(m.text ?? '')
    return (
      <table className="cv-block cv-table" style={style}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ height: BLOCK_ROW.table * k }}>
              {r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (m.kind === 'checklist')
    return (
      <ul className="cv-block cv-check" style={style}>
        {checkLines(m.text ?? '').map((l, i) => (
          <li key={i} className={l.done ? 'done' : ''} style={{ height: BLOCK_ROW.checklist * k }}>
            <button
              type="button"
              role="checkbox"
              aria-checked={l.done}
              aria-label={l.text || 'Item'}
              onClick={() => onToggle(m.id, i)}
            />
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
    )
  return (
    <pre className="cv-block cv-code" style={{ ...style, lineHeight: `${BLOCK_ROW.code * k}px` }}>
      {m.text || ' '}
    </pre>
  )
}

interface Props {
  marks: CanvasMark[]
  selected: ReadonlySet<string>
  editing: string | null
  onText: (id: string, text: string | null) => void
  onToggle: (id: string, line: number) => void
  /** What was typed to start editing (the first character), for the mark being edited. */
  first: string | null
  /** A label's text needs another size: a shape grows taller, a text label takes its text's size. */
  onFit: (id: string, size: { w?: number; h?: number }) => void
}

/** The freehand lines, shapes, text and blocks of the board, in one SVG layer in the board's own coordinates. */
export const Marks = memo(function Marks({
  marks,
  selected,
  editing,
  onText,
  onToggle,
  first,
  onFit
}: Props): React.JSX.Element {
  return (
    <svg className="cv-marks" role="group" aria-label="Drawings">
      {marks.map((m) => {
        const sel = selected.has(`m:${m.id}`)
        if (m.pts) {
          return (
            <path
              key={m.id}
              data-mid={m.id}
              d={linePath(m.pts)}
              fill="none"
              stroke={col(m.color)}
              strokeWidth={m.kind === 'marker' ? 16 : 3}
              strokeOpacity={m.kind === 'marker' ? 0.35 : 1}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={sel ? 'sel' : ''}
            />
          )
        }
        const rot = m.rot ? `rotate(${m.rot} ${m.w / 2} ${m.h / 2})` : ''
        const block = isBlock(m.kind)
        return (
          <g
            key={m.id}
            data-mid={m.id}
            transform={`translate(${m.x} ${m.y}) ${rot}`}
            className={(sel ? 'sel' : '') + (m.locked ? ' locked' : '')}
          >
            {isShape(m.kind) && <Body m={m} />}
            {/* a shape with no text has no HTML in it: hundreds of shapes stay cheap */}
            {block && (
              <foreignObject
                x={0}
                y={0}
                width={m.w}
                height={m.h}
                className={editing === m.id ? 'editing' : block ? 'block' : ''}
              >
                {editing === m.id ? (
                  m.kind === 'table' ? (
                    <TableEditor m={m} onText={onText} />
                  ) : (
                    <Editor m={m} onText={onText} />
                  )
                ) : (
                  <BlockView m={m} onToggle={onToggle} />
                )}
              </foreignObject>
            )}
            {!block && (m.text || editing === m.id) && (
              <Label
                m={m}
                editing={editing === m.id}
                first={editing === m.id ? first : null}
                onText={onText}
                onFit={onFit}
              />
            )}
            {sel && (
              <g className="cv-mark-handles">
                <rect className="outline" x={-3} y={-3} width={m.w + 6} height={m.h + 6} />
                {!m.locked && (
                  <>
                    <rect
                      data-mh="resize"
                      data-mid={m.id}
                      className={'grip' + (block || m.kind === 'text' ? ' ew' : '')}
                      x={m.w - 5}
                      y={(block || m.kind === 'text' ? m.h / 2 : m.h) - 5}
                      width={10}
                      height={10}
                      rx={2}
                    />
                    {!block && (
                      <circle
                        data-mh="rotate"
                        data-mid={m.id}
                        className="grip"
                        cx={m.w / 2}
                        cy={-18}
                        r={5}
                      />
                    )}
                  </>
                )}
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
})

/**
 * The text of a shape or a text label: one element for showing and for typing (WYSIWYG, nothing moves when editing
 * starts or ends). In a shape it is centred in the shape's text box and the shape grows to hold it; a text label is
 * left aligned and as wide as its longest line until it is resized, then it wraps. Typing: Enter is a new line, Esc or
 * a click elsewhere ends (and keeps what was typed).
 */
function Label({
  m,
  editing,
  first,
  onText,
  onFit
}: {
  m: CanvasMark
  editing: boolean
  first: string | null
  onText: Props['onText']
  onFit: Props['onFit']
}): React.JSX.Element {
  const inner = useRef<HTMLDivElement>(null)
  const shape = isShape(m.kind)
  const box = shape ? textInset(m.kind as ShapeKind, m.w, m.h) : { x: 0, y: 0, w: m.w, h: m.h }
  const size = sizeOf(m)
  const fit = (): void => {
    const el = inner.current
    if (!el) return
    if (shape) {
      const h = heightFor(m.kind as ShapeKind, m.h, el.offsetHeight)
      if (h !== m.h) onFit(m.id, { h })
      return
    }
    const w = m.wrap ? m.w : Math.max(40, Math.ceil(el.offsetWidth) + 2)
    const h = Math.max(Math.ceil(size * 1.3), Math.ceil(el.offsetHeight))
    if (Math.abs(w - m.w) > 1 || Math.abs(h - m.h) > 1) onFit(m.id, { w, h })
  }
  const fitRef = useRef(fit)
  useLayoutEffect(() => {
    fitRef.current = fit
    fit()
  })
  useEffect(() => {
    const el = inner.current
    if (!editing || !el) return
    el.textContent = (m.text ?? '') + (first ?? '')
    el.focus()
    // the caret at the end of what is there
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
    fitRef.current()
    // only when editing starts: what is typed after is the element's own
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])
  const done = (): void => onText(m.id, inner.current?.innerText.replace(/\n$/, '') ?? '')
  return (
    <foreignObject
      x={box.x}
      y={box.y}
      width={box.w}
      height={box.h}
      className={'cv-label' + (editing ? ' editing' : '')}
    >
      <div
        className={'cv-mt' + (shape ? '' : ' plain') + (!shape && !m.wrap ? ' auto' : '')}
        style={{
          fontSize: size,
          fontWeight: size >= HEADING_MIN ? 650 : undefined,
          color: m.kind === 'text' ? col(m.color) : 'var(--fg)'
        }}
      >
        {editing ? (
          <div
            ref={inner}
            className="cv-mt-in"
            contentEditable="plaintext-only"
            role="textbox"
            aria-multiline="true"
            aria-label={shape ? 'Shape text' : 'Text'}
            spellCheck
            suppressContentEditableWarning
            onPointerDown={(e) => e.stopPropagation()}
            onInput={() => fitRef.current()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                e.preventDefault()
                done()
              }
            }}
            onBlur={done}
          />
        ) : (
          <div ref={inner} className="cv-mt-in">
            {m.text}
          </div>
        )}
      </div>
    </foreignObject>
  )
}

/**
 * A block's text in place: a checklist or code block takes Enter as a new line and Ctrl+Enter, Escape or a click
 * elsewhere to finish. Escape keeps what was typed.
 */
function Editor({ m, onText }: { m: CanvasMark; onText: Props['onText'] }): React.JSX.Element {
  const area = useRef<HTMLTextAreaElement>(null)
  const multi = isBlock(m.kind)
  useEffect(() => {
    area.current?.focus()
    if (!multi) area.current?.select()
  }, [multi])
  return (
    <textarea
      ref={area}
      className={'cv-mark-edit' + (multi ? ' block' : '') + (m.kind === 'code' ? ' code' : '')}
      defaultValue={m.text ?? ''}
      maxLength={4000}
      aria-label={m.kind === 'code' ? 'Code' : m.kind === 'checklist' ? 'Checklist' : 'Text'}
      spellCheck={m.kind !== 'code'}
      style={{ fontSize: sizeOf(m) }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        const t = e.currentTarget
        if (e.key === 'Escape') onText(m.id, t.value)
        else if (e.key === 'Tab' && m.kind === 'code') {
          e.preventDefault()
          t.setRangeText('  ', t.selectionStart, t.selectionEnd, 'end')
        } else if (e.key === 'Enter' && (multi ? e.ctrlKey || e.metaKey : !e.shiftKey)) {
          e.preventDefault()
          onText(m.id, t.value)
        }
      }}
      onBlur={(e) => onText(m.id, e.currentTarget.value)}
    />
  )
}

/** A table edited cell by cell: Tab moves on, Enter goes down, the buttons add a row or a column. */
function TableEditor({ m, onText }: { m: CanvasMark; onText: Props['onText'] }): React.JSX.Element {
  const [rows, setRows] = useState(() => parseTable(m.text ?? ''))
  const box = useRef<HTMLDivElement>(null)
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])
  useEffect(() => {
    box.current?.querySelector('input')?.focus()
  }, [])
  const finish = (): void => onText(m.id, tableText(rowsRef.current))
  const set = (i: number, j: number, v: string): void =>
    setRows((rs) => rs.map((r, a) => (a === i ? r.map((c, b) => (b === j ? v : c)) : r)))
  return (
    <div
      ref={box}
      className="cv-table-edit"
      style={{ fontSize: sizeOf(m) }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) finish()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') finish()
        else if (e.key === 'Enter') {
          e.preventDefault()
          const all = [...(box.current?.querySelectorAll('input') ?? [])]
          const i = all.indexOf(e.target as HTMLInputElement)
          const cols = rowsRef.current[0]?.length ?? 1
          all[i + cols]?.focus()
        }
      }}
    >
      <table>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>
                  <input
                    value={c}
                    aria-label={`Row ${i + 1}, column ${j + 1}`}
                    onChange={(e) => set(i, j, e.currentTarget.value)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cv-table-more">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, Array<string>(rs[0]?.length ?? 1).fill('')])}
        >
          Add row
        </button>
        <button type="button" onClick={() => setRows((rs) => rs.map((r) => [...r, '']))}>
          Add column
        </button>
      </div>
    </div>
  )
}
