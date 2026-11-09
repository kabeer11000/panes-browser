import { memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { CanvasState } from '@shared/ai/canvas'
import {
  anchorOn,
  connectorsOf,
  endBox,
  routeAll,
  routeDraft,
  type CanvasConnector,
  type ConnectorHeads,
  type ConnectorShape,
  type End,
  type Offsets,
  type Side
} from '@shared/ai/connectors'
import {
  ArrowBothIcon,
  ArrowEndIcon,
  ArrowNoneIcon,
  CurvedIcon,
  ElbowIcon,
  LabelIcon,
  StraightIcon,
  TrashIcon
} from './icons'

export interface Draft {
  from: End
  to: End
  /** The object the moving end would attach to (outlined). */
  target: End | null
  /** A connector whose end is being moved: hidden while its draft is drawn. */
  hide: string | null
}
export interface ConnectorsHandle {
  /** Objects being dragged and by how much (null: the drag is over). */
  drag: (off: Offsets | null) => void
  draft: (d: Draft | null) => void
  hover: (e: End | null) => void
}
export interface Style {
  shape: ConnectorShape
  heads: ConnectorHeads
}

interface Props {
  state: CanvasState
  /** Ids of the selected connectors. */
  selected: string[]
  editing: string | null
  /** A connector just made: it draws itself in. */
  fresh: string | null
  handles: boolean
  style: Style
  reduced: boolean
  onLabel: (id: string, text: string | null) => void
  onPatch: (id: string, patch: Partial<Style>) => void
  onEditLabel: (id: string) => void
  onDelete: (ids: string[]) => void
  ref?: React.Ref<ConnectorsHandle>
}

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const NX: Record<Side, [number, number]> = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0]
}

/**
 * The board's connectors: one SVG inside the transformed board layer (pan and zoom move it for free), labels and
 * the style bar as HTML beside it. Geometry is pure (shared/ai/connectors.ts) and comes from the state, plus the
 * offsets of a drag in progress, which only this layer redraws.
 */
export const Connectors = memo(function Connectors({
  state,
  selected,
  editing,
  fresh,
  handles,
  style,
  reduced,
  onLabel,
  onPatch,
  onEditLabel,
  onDelete,
  ref
}: Props): React.JSX.Element {
  const [off, setOff] = useState<Offsets | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [hover, setHover] = useState<End | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  useImperativeHandle(
    ref,
    () => ({
      drag: (o) => setOff(o),
      draft: (d) => setDraft(d),
      hover: (e) =>
        setHover((cur) =>
          cur === e || (cur && e && JSON.stringify(cur) === JSON.stringify(e)) ? cur : e
        )
    }),
    []
  )
  const list = connectorsOf(state)
  const sel = new Set(selected)
  const all = routeAll(state, list, off ?? undefined)
  const routes = list.map((c, i) => ({ c, r: all[i] }))
  const one = selected.length === 1 ? routes.find((x) => x.c.id === selected[0]) : undefined

  // a new connector draws itself in along its length, then its arrowheads appear
  useLayoutEffect(() => {
    if (!fresh || reduced) return
    const g = svg.current?.querySelector(`[data-kid="${fresh}"]`)
    const line = g?.querySelector<SVGPathElement>('.cv-kline')
    if (!line) return
    const l = line.getTotalLength()
    line.animate(
      [
        { strokeDasharray: `${l} ${l}`, strokeDashoffset: `${l}` },
        { strokeDasharray: `${l} ${l}`, strokeDashoffset: '0' }
      ],
      { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    )
    g?.querySelectorAll('.cv-khead').forEach((h) =>
      h.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 300, fill: 'backwards' })
    )
  }, [fresh, reduced])

  const dr = draft ? routeDraft(state, draft.from, draft.to, style.shape, style.heads) : null
  const target = draft?.target ? endBox(state, draft.target) : null
  const hb = hover && !draft && !off && handles ? endBox(state, hover) : null

  return (
    <>
      <svg
        ref={svg}
        className="cv-links"
        width="1"
        height="1"
        overflow="visible"
        aria-hidden="true"
      >
        {routes.map(({ c, r }) =>
          !r || draft?.hide === c.id ? null : (
            <g key={c.id} data-kid={c.id} className={'cv-link' + (sel.has(c.id) ? ' sel' : '')}>
              <path className="cv-khit" d={r.d} data-kid={c.id} />
              <path className="cv-kline" d={r.d} />
              {r.heads.map((h, i) => (
                <path key={i} className="cv-khead" d={h} />
              ))}
            </g>
          )
        )}
        {target && (
          <rect
            className="cv-ktarget"
            x={target.x - 4}
            y={target.y - 4}
            width={target.w + 8}
            height={target.h + 8}
            rx={draft?.target?.kind === 'frame' ? 22 : 16}
          />
        )}
        {dr && (
          <g className="cv-link draft">
            <path className="cv-kline" d={dr.d} />
            {dr.heads.map((h, i) => (
              <path key={i} className="cv-khead" d={h} />
            ))}
          </g>
        )}
        {one?.r && !draft && !off && (
          <>
            <circle
              className="cv-kend"
              cx={one.r.a.x}
              cy={one.r.a.y}
              r="5"
              data-kend="from"
              data-kid={one.c.id}
            />
            <circle
              className="cv-kend"
              cx={one.r.b.x}
              cy={one.r.b.y}
              r="5"
              data-kend="to"
              data-kid={one.c.id}
            />
          </>
        )}
        {hb &&
          hover &&
          SIDES.map((side) => {
            const p = anchorOn(hb, side, 0)
            const [nx, ny] = NX[side]
            return (
              <circle
                key={side}
                className="cv-handle"
                cx={p.x}
                cy={p.y}
                r="5"
                style={{ '--nx': nx, '--ny': ny } as React.CSSProperties}
                data-handle={side}
                data-hkind={hover.kind}
                data-hid={hover.kind === 'point' ? '' : String(hover.id)}
              />
            )
          })}
      </svg>
      {routes.map(({ c, r }) =>
        !r || draft?.hide === c.id || (!c.label && editing !== c.id) ? null : (
          <div
            key={c.id}
            className={'cv-klabel' + (sel.has(c.id) ? ' sel' : '')}
            data-kid={c.id}
            style={{ left: r.mid.x, top: r.mid.y }}
          >
            {editing === c.id ? <LabelInput id={c.id} value={c.label} onDone={onLabel} /> : c.label}
          </div>
        )
      )}
      {one?.r && !draft && !off && editing !== one.c.id && (
        <div
          className={'cv-kbar' + (one.c.label ? ' above' : '')}
          style={{ left: one.r.mid.x, top: one.r.mid.y }}
          role="toolbar"
          aria-label="Connector style"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <StyleButtons c={one.c} onPatch={onPatch} />
          <span className="cv-ksep" aria-hidden="true" />
          <button
            type="button"
            className="cv-kbtn"
            title="Label (double-click the line)"
            aria-label="Edit label"
            onClick={() => onEditLabel(one.c.id)}
          >
            <LabelIcon />
          </button>
          <button
            type="button"
            className="cv-kbtn"
            title="Delete (Delete)"
            aria-label="Delete connector"
            onClick={() => onDelete([one.c.id])}
          >
            <TrashIcon />
          </button>
        </div>
      )}
    </>
  )
})

function StyleButtons({
  c,
  onPatch
}: {
  c: CanvasConnector
  onPatch: Props['onPatch']
}): React.JSX.Element {
  const shapes: Array<[ConnectorShape, string, React.JSX.Element]> = [
    ['straight', 'Straight', <StraightIcon key="s" />],
    ['curved', 'Curved', <CurvedIcon key="c" />],
    ['elbow', 'Elbow', <ElbowIcon key="e" />]
  ]
  const heads: Array<[ConnectorHeads, string, React.JSX.Element]> = [
    ['none', 'No arrows', <ArrowNoneIcon key="n" />],
    ['end', 'Arrow at the end', <ArrowEndIcon key="e" />],
    ['both', 'Arrows at both ends', <ArrowBothIcon key="b" />]
  ]
  return (
    <>
      {shapes.map(([v, label, icon]) => (
        <button
          key={v}
          type="button"
          className={'cv-kbtn' + (c.shape === v ? ' on' : '')}
          aria-pressed={c.shape === v}
          aria-label={label}
          title={label}
          onClick={() => onPatch(c.id, { shape: v })}
        >
          {icon}
        </button>
      ))}
      <span className="cv-ksep" aria-hidden="true" />
      {heads.map(([v, label, icon]) => (
        <button
          key={v}
          type="button"
          className={'cv-kbtn' + (c.heads === v ? ' on' : '')}
          aria-pressed={c.heads === v}
          aria-label={label}
          title={label}
          onClick={() => onPatch(c.id, { heads: v })}
        >
          {icon}
        </button>
      ))}
    </>
  )
}

function LabelInput({
  id,
  value,
  onDone
}: {
  id: string
  value: string
  onDone: (id: string, text: string | null) => void
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <input
      ref={input}
      className="cv-klabel-input"
      defaultValue={value}
      maxLength={60}
      size={Math.max(6, value.length + 1)}
      aria-label="Connector label"
      placeholder="Label"
      spellCheck={false}
      onPointerDown={(e) => e.stopPropagation()}
      onInput={(e) => (e.currentTarget.size = Math.max(6, e.currentTarget.value.length + 1))}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onDone(id, e.currentTarget.value)
        else if (e.key === 'Escape') onDone(id, null)
      }}
      onBlur={(e) => onDone(id, e.currentTarget.value)}
    />
  )
}
