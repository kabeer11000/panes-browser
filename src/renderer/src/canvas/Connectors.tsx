import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import type { CanvasState } from '@shared/ai/canvas'
import {
  anchorOn,
  connectorsOf,
  endKey,
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
import { onFollow } from './lift'

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

/** Whether moving these objects changes any connector's route. */
const movesLines = (s: CanvasState, o: Offsets): boolean => {
  const list = connectorsOf(s)
  if (!list.length) return false
  if (list.some((c) => c.shape === 'elbow')) return true
  for (const k of o.keys()) if (!/^[cnfm]./.test(k)) return true
  // a section's connectors hang off it; a card in a section is moved under its own key
  return list.some((c) => {
    const a = endKey(c.from)
    const b = endKey(c.to)
    return (a !== null && o.has(a)) || (b !== null && o.has(b))
  })
}
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
  // a drawing being dragged (marks): only whether one is, for the handles; where its lines go is written directly
  const [off, setOff] = useState<boolean>(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [hover, setHover] = useState<End | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const stateRef = useRef(state)
  /** The `d` each connector shows now (React's, or the last one written while something moved). */
  const shown = useRef(new Map<string, string>())
  /** Some line shows a route React did not render (something is moving). */
  const dirty = useRef(false)
  useLayoutEffect(() => {
    stateRef.current = state
  })
  /**
   * Things are moving (a drag, its settle, a glide): the lines follow every frame, written straight into the paths of
   * the connectors whose route changed, no render. Null: all still again, every line back to React's own route.
   */
  const follow = useCallback((o: Offsets | null): void => {
    const s = stateRef.current
    const root = svg.current
    if (!root) return
    // most motion touches no connector: nothing to route then
    if (o && !movesLines(s, o)) o = null
    if (!o && !dirty.current) return
    const list = connectorsOf(s)
    const all = routeAll(s, list, o ?? undefined)
    const labels = root.parentElement
    list.forEach((c, i) => {
      const r = all[i]
      if (!r || shown.current.get(c.id) === r.d) return
      shown.current.set(c.id, r.d)
      const g = root.querySelector(`g[data-kid="${c.id}"]`)
      if (!g) return
      const paths = g.children
      // hit line, line, then the heads (the render's order)
      ;(paths[0] as SVGPathElement | undefined)?.setAttribute('d', r.d)
      ;(paths[1] as SVGPathElement | undefined)?.setAttribute('d', r.d)
      r.heads.forEach((h, j) => (paths[2 + j] as SVGPathElement | undefined)?.setAttribute('d', h))
      const lab = labels?.querySelector<HTMLElement>(`.cv-klabel[data-kid="${c.id}"]`)
      if (lab) {
        lab.style.left = `${r.mid.x}px`
        lab.style.top = `${r.mid.y}px`
      }
    })
    dirty.current = o !== null
  }, [])
  useEffect(() => onFollow(follow), [follow])
  useImperativeHandle(
    ref,
    () => ({
      drag: (o) => {
        setOff(o !== null)
        follow(o)
      },
      draft: (d) => setDraft(d),
      hover: (e) =>
        setHover((cur) =>
          cur === e || (cur && e && JSON.stringify(cur) === JSON.stringify(e)) ? cur : e
        )
    }),
    [follow]
  )
  const list = connectorsOf(state)
  const sel = new Set(selected)
  const all = routeAll(state, list)
  const routes = list.map((c, i) => ({ c, r: all[i] }))
  // what shows now, read back from the paths (a render writes only the props that changed, so a line written while
  // something moved may still show that): a follow writes only what differs from it
  useLayoutEffect(() => {
    const m = shown.current
    m.clear()
    let differs = false
    list.forEach((c, i) => {
      const d = svg.current?.querySelector(`g[data-kid="${c.id}"] > .cv-kline`)?.getAttribute('d')
      if (!d) return
      m.set(c.id, d)
      if (d !== all[i]?.d) differs = true
    })
    dirty.current = differs
  })
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
