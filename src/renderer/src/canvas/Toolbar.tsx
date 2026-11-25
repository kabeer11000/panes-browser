import { arrangeLabel } from '@shared/ai/canvasMenu'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useDismiss } from './useDismiss'
import './surfaces.css'
import { SHAPE_KINDS, type BlockKind, type ShapeKind } from '@shared/ai/canvasMarks'
import {
  ConnectorIcon,
  DocIcon,
  FrameIcon,
  HandIcon,
  HighlighterArt,
  LineIcon,
  MarkerIcon,
  NoteIcon,
  PenIcon,
  PencilArt,
  PlusIcon,
  SearchGlyph,
  SelectIcon,
  ShapeClusterIcon,
  ShapeIcon,
  StickyArt,
  TableIcon,
  TextIcon,
  TidyIcon,
  GearIcon,
  StopwatchIcon
} from './icons'
import { WIDGET_LABEL, type WidgetKind } from '@shared/widgets'
import { useSelfWidth } from './useSelfWidth'

export type Tool =
  'select' | 'hand' | 'frame' | 'note' | 'connector' | 'line' | 'pen' | 'marker' | 'shape' | 'text'

export type BlockChoice = BlockKind | 'heading' | 'body'
const BLOCKS: Array<{ id: BlockChoice; label: string }> = [
  { id: 'heading', label: 'Heading' },
  { id: 'body', label: 'Body text' },
  { id: 'table', label: 'Table' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'code', label: 'Code block' }
]

const SHAPE_LABEL: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  rounded: 'Rounded rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  triangle: 'Triangle',
  arrow: 'Arrow',
  star: 'Star',
  bubble: 'Speech bubble'
}

type ToolDef = { id: Tool; label: string; key: string; icon: React.JSX.Element }
const def = (id: Tool, label: string, key: string, icon: React.JSX.Element): ToolDef => ({
  id,
  label,
  key,
  icon
})
// the bar: moving about, then putting things down; drawing tools share one button (the last one picked)
const NAV: ToolDef[] = [
  def('select', 'Select (Shift and drag inside a section to select in it)', 'V', <SelectIcon />),
  def('hand', 'Hand (or hold Space)', 'H', <HandIcon />)
]
const NOTE = def('note', 'Sticky note', 'S', <NoteIcon />)
const TEXT = def('text', 'Text', 'T', <TextIcon />)
const FRAME = def('frame', 'Section (or Alt and drag)', 'F', <FrameIcon />)
/** The pencil's tools: it shows as the one last picked. */
const DRAW: ToolDef[] = [
  def('pen', 'Pen', 'P', <PenIcon />),
  def('marker', 'Highlighter', 'M', <MarkerIcon />)
]
/** Lines that join things live with the shapes, as in the cluster's icon. */
const LINKS: ToolDef[] = [
  def('line', 'Line', 'L', <LineIcon />),
  def('connector', 'Connector (or drag a dot on an object)', 'C', <ConnectorIcon />)
]
const SHAPEISH: Tool[] = ['shape', 'line', 'connector']

interface Props {
  tool: Tool
  zoom: number
  /** The zoom label itself: the board writes it every frame of a zoom, without a render (see Canvas onMove). */
  zoomRef?: React.Ref<HTMLSpanElement>
  busy: boolean
  /** The prompt is searching or the model is answering. */
  finding: boolean
  /** An answer is open above the bar: the box asks follow-ups. */
  asking?: boolean
  /** Show the inline prompt in the bottom bar (only when AI is off or unavailable). */
  showPrompt?: boolean
  /** AI is on and ready: Arrange groups by topic (else by site). */
  ai?: boolean
  promptRef: React.RefObject<HTMLInputElement | null>
  shapeKind: ShapeKind
  onShapeKind: (k: ShapeKind) => void
  /** Put a block (heading, body text, table, checklist, code) in the middle of the view. */
  onBlock: (b: BlockChoice) => void
  /** Put a stopwatch, timer or reminder in the middle of the view. */
  onWidget: (w: WidgetKind) => void
  /** Tabs that can be @mentioned in the box. */
  mentionable: Array<{ tab: number; title: string }>
  onMention: (tab: number) => void
  onPrompt: (query: string) => void
  onTool: (t: Tool) => void
  onTidy: () => void
  onSettings: () => void
  onFit: () => void
}

/**
 * The floating bar at the bottom of the board, after FigJam's: moving about, then the pencil and the sticky pad as
 * objects standing in the bar (they rise when picked), shapes and lines as one cluster, then things to put down.
 */
export function Toolbar({
  tool,
  zoom,
  zoomRef,
  busy,
  finding,
  asking = false,
  showPrompt = false,
  ai = true,
  promptRef,
  shapeKind,
  onShapeKind,
  onBlock,
  onWidget,
  mentionable,
  onMention,
  onPrompt,
  onTool,
  onTidy,
  onSettings,
  onFit
}: Props): React.JSX.Element {
  const [shapes, setShapes] = useState(false)
  const [blocks, setBlocks] = useState(false)
  const [widgets, setWidgets] = useState(false)
  const [draws, setDraws] = useState(false)
  const [lastDraw, setLastDraw] = useState<ToolDef>(DRAW[0])
  const draw = DRAW.find((d) => d.id === tool) ?? lastDraw
  const [at, setAt] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const barWidth = useSelfWidth<HTMLDivElement>()
  const shapesBox = useRef<HTMLDivElement>(null)
  const blocksBox = useRef<HTMLDivElement>(null)
  const widgetsBox = useRef<HTMLDivElement>(null)
  const drawsBox = useRef<HTMLDivElement>(null)
  useDismiss(
    shapes,
    shapesBox,
    useCallback(() => setShapes(false), [])
  )
  useDismiss(
    draws,
    drawsBox,
    useCallback(() => setDraws(false), [])
  )
  useDismiss(
    blocks,
    blocksBox,
    useCallback(() => setBlocks(false), [])
  )
  useDismiss(
    widgets,
    widgetsBox,
    useCallback(() => setWidgets(false), [])
  )
  // the chosen tool's highlight glides from tool to tool (as in FigJam) instead of jumping
  useLayoutEffect(() => {
    const bar = box.current
    if (!bar) return
    const place = (): void => {
      const on = bar.querySelector<HTMLElement>('.cv-tool.on:not(.cv-phys)')
      // its place in the bar: a tool with a menu sits in its own positioned box, so add up the offsets to the bar
      let x = 0
      for (
        let el: HTMLElement | null = on;
        el && el !== bar;
        el = el.offsetParent as HTMLElement | null
      )
        x += el.offsetLeft
      bar.style.setProperty('--pill-x', `${x}px`)
      bar.style.setProperty('--pill-w', `${on ? on.offsetWidth : 0}px`)
      bar.classList.toggle('has-pill', !!on)
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [tool, showPrompt])
  /** A tool with a menu: a click picks it, a click on it once picked (or a right-click) opens its menu. */
  const menuTool = (
    picked: boolean,
    pick: () => void,
    toggle: (f: (m: boolean) => boolean) => void
  ): Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'onContextMenu'> => ({
    onClick: () => (picked ? toggle((m) => !m) : pick()),
    onContextMenu: (e) => {
      e.preventDefault()
      pick()
      toggle(() => true)
    }
  })
  return (
    <div
      className="cv-bar"
      role="toolbar"
      aria-label="Canvas tools"
      ref={(el) => {
        box.current = el
        barWidth(el)
      }}
    >
      <i className="cv-bar-pill" aria-hidden="true" />
      {NAV.map(toolButton)}
      <span className="cv-sep" aria-hidden="true" />
      <div className="cv-split cv-phys-slot" ref={drawsBox}>
        <button
          type="button"
          className={'cv-tool cv-phys pencil' + (tool === draw.id ? ' on' : '')}
          aria-pressed={tool === draw.id}
          aria-haspopup="menu"
          aria-expanded={draws}
          aria-label={draw.label}
          title={`${draw.label} (${draw.key}; click again for the other pen)`}
          {...menuTool(tool === draw.id, () => onTool(draw.id), setDraws)}
        >
          {draw.id === 'marker' ? <HighlighterArt /> : <PencilArt />}
        </button>
        {draws && (
          <div className="cv-menu rows" role="menu">
            {DRAW.map((d) => (
              <button
                key={d.id}
                type="button"
                role="menuitemradio"
                aria-checked={d.id === draw.id}
                onClick={() => {
                  setDraws(false)
                  setLastDraw(d)
                  onTool(d.id)
                }}
              >
                {d.icon}
                <span>{d.label}</span>
                <kbd>{d.key}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className={'cv-tool cv-phys sticky' + (tool === 'note' ? ' on' : '')}
        aria-pressed={tool === 'note'}
        aria-label={NOTE.label}
        title={`${NOTE.label} (${NOTE.key})`}
        onClick={() => onTool('note')}
      >
        <StickyArt />
      </button>
      <span className="cv-sep" aria-hidden="true" />
      <div className="cv-split" ref={shapesBox}>
        <button
          type="button"
          className={'cv-tool cv-cluster' + (SHAPEISH.includes(tool) ? ' on' : '')}
          aria-pressed={SHAPEISH.includes(tool)}
          aria-haspopup="menu"
          aria-expanded={shapes}
          aria-label={`Shapes and lines: ${SHAPE_LABEL[shapeKind]}`}
          title="Shapes and lines (R; click again for more)"
          {...menuTool(SHAPEISH.includes(tool), () => onTool('shape'), setShapes)}
        >
          <ShapeClusterIcon />
        </button>
        {shapes && (
          <div className="cv-menu rows" role="menu">
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="menuitemradio"
                aria-checked={tool === 'shape' && k === shapeKind}
                onClick={() => {
                  setShapes(false)
                  onShapeKind(k)
                  onTool('shape')
                }}
              >
                <ShapeIcon />
                <span>{SHAPE_LABEL[k]}</span>
              </button>
            ))}
            <i className="cv-menu-sep" aria-hidden="true" />
            {LINKS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="menuitemradio"
                aria-checked={tool === d.id}
                onClick={() => {
                  setShapes(false)
                  onTool(d.id)
                }}
              >
                {d.icon}
                <span>{d.label.replace(/ \(.*\)$/, '')}</span>
                <kbd>{d.key}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="cv-sep" aria-hidden="true" />
      {toolButton(TEXT)}
      {toolButton(FRAME)}
      <button
        type="button"
        className="cv-tool"
        aria-label="Table"
        title="Table"
        onClick={() => onBlock('table')}
      >
        <TableIcon />
      </button>
      <button
        type="button"
        className="cv-tool"
        aria-label="Checklist"
        title="Checklist"
        onClick={() => onBlock('checklist')}
      >
        <DocIcon />
      </button>
      <div className="cv-split" ref={blocksBox}>
        <button
          type="button"
          className={'cv-tool cv-plus' + (blocks ? ' open' : '')}
          aria-label="More to add"
          title="Heading, text, table, checklist, code"
          aria-haspopup="menu"
          aria-expanded={blocks}
          onClick={() => setBlocks((m) => !m)}
        >
          <PlusIcon />
        </button>
        {blocks && (
          <div className="cv-menu" role="menu">
            {BLOCKS.map((b) => (
              <button
                key={b.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setBlocks(false)
                  onBlock(b.id)
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* the board's widgets, in reach on the bar (they were only in the command menu and the right-click menu) */}
      <div className="cv-split" ref={widgetsBox}>
        <button
          type="button"
          className={'cv-tool' + (widgets ? ' open' : '')}
          aria-label="Widgets"
          title="Stopwatch, timer, reminder"
          aria-haspopup="menu"
          aria-expanded={widgets}
          onClick={() => setWidgets((m) => !m)}
        >
          <StopwatchIcon />
        </button>
        {widgets && (
          <div className="cv-menu" role="menu">
            {(['stopwatch', 'timer', 'reminder'] as const).map((w) => (
              <button
                key={w}
                type="button"
                role="menuitem"
                onClick={() => {
                  setWidgets(false)
                  onWidget(w)
                }}
              >
                {WIDGET_LABEL[w]}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="cv-sep" aria-hidden="true" />
      {showPrompt && (
        <>
          <form
            className={
              'cv-prompt ai-edge' + (finding ? ' finding on' : '') + (asking ? ' asking' : '')
            }
            onSubmit={(e) => {
              e.preventDefault()
              const input = promptRef.current
              if (!input || input.value.trim() === '') return
              onPrompt(input.value)
              input.value = ''
              input.blur()
            }}
          >
            <SearchGlyph />
            <input
              ref={promptRef}
              type="text"
              placeholder="Find or open address"
              aria-label="Find or open address"
              autoComplete="off"
              spellCheck={false}
              maxLength={300}
              onChange={(e) => {
                const m = /@([^\s@]{0,30})$/.exec(e.currentTarget.value)
                setAt(m ? m[1].toLowerCase() : null)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') e.currentTarget.blur()
              }}
            />
            {at !== null && (
              <div className="cv-mention" role="listbox" aria-label="Mention a tab">
                {mentionable
                  .filter((t) => t.title.toLowerCase().includes(at))
                  .slice(0, 6)
                  .map((t) => (
                    <button
                      key={t.tab}
                      type="button"
                      role="option"
                      aria-selected="false"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const input = promptRef.current
                        if (input) input.value = input.value.replace(/@[^\s@]{0,30}$/, '')
                        setAt(null)
                        onMention(t.tab)
                      }}
                    >
                      {t.title}
                    </button>
                  ))}
              </div>
            )}
            <kbd aria-hidden="true">/</kbd>
            <i className="cv-prompt-dot" aria-hidden="true" />
          </form>
          <span className="cv-sep" aria-hidden="true" />
        </>
      )}
      <button
        type="button"
        className={'cv-tool' + (busy ? ' busy' : '')}
        disabled={busy}
        aria-busy={busy}
        aria-label={arrangeLabel(ai)}
        title={`${arrangeLabel(ai)}: group the cards into sections; your own sections stay (Shift+T)`}
        onClick={onTidy}
      >
        <TidyIcon />
      </button>
      <button
        type="button"
        className="cv-zoom"
        title="Fit everything (Shift+1); zoom with + and - or Ctrl and the wheel"
        onClick={onFit}
      >
        <span ref={zoomRef}>{zoom}%</span>
      </button>
      <button
        type="button"
        className="cv-tool"
        aria-label="Settings"
        title="Settings"
        onClick={onSettings}
      >
        <GearIcon />
      </button>
    </div>
  )

  function toolButton(t: ToolDef): React.JSX.Element {
    return (
      <button
        key={t.id}
        type="button"
        className={'cv-tool' + (tool === t.id ? ' on' : '')}
        aria-pressed={tool === t.id}
        aria-label={t.label}
        title={`${t.label} (${t.key})`}
        onClick={() => onTool(t.id)}
      >
        {t.icon}
      </button>
    )
  }
}
