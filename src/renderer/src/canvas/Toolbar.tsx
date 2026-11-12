import { arrangeLabel } from '@shared/ai/canvasMenu'
import { useCallback, useRef, useState } from 'react'
import { useDismiss } from './useDismiss'
import { SHAPE_KINDS, type BlockKind, type ShapeKind } from '@shared/ai/canvasMarks'
import {
  BlockIcon,
  ChevronIcon,
  ConnectorIcon,
  FrameIcon,
  HandIcon,
  LineIcon,
  MarkerIcon,
  NoteIcon,
  PenIcon,
  SearchGlyph,
  SelectIcon,
  ShapeIcon,
  TextIcon,
  TidyIcon,
  GearIcon
} from './icons'

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
const PUT: ToolDef[] = [
  def('note', 'Sticky note', 'S', <NoteIcon />),
  def('text', 'Text', 'T', <TextIcon />)
]
const FRAME = def('frame', 'Section (or Alt and drag)', 'F', <FrameIcon />)
const DRAW: ToolDef[] = [
  def('pen', 'Pen', 'P', <PenIcon />),
  def('marker', 'Highlighter', 'M', <MarkerIcon />),
  def('line', 'Line', 'L', <LineIcon />),
  def('connector', 'Connector (or drag a dot on an object)', 'C', <ConnectorIcon />)
]

interface Props {
  tool: Tool
  zoom: number
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
  /** Tabs that can be @mentioned in the box. */
  mentionable: Array<{ tab: number; title: string }>
  onMention: (tab: number) => void
  onPrompt: (query: string) => void
  onTool: (t: Tool) => void
  onTidy: () => void
  onSettings: () => void
  onFit: () => void
  onZoom: (factor: number) => void
}

/** The floating bar at the bottom of the board. Quiet: it is a row of small buttons, nothing more. */
export function Toolbar({
  tool,
  zoom,
  busy,
  finding,
  asking = false,
  showPrompt = false,
  ai = true,
  promptRef,
  shapeKind,
  onShapeKind,
  onBlock,
  mentionable,
  onMention,
  onPrompt,
  onTool,
  onTidy,
  onSettings,
  onFit,
  onZoom
}: Props): React.JSX.Element {
  const [shapes, setShapes] = useState(false)
  const [blocks, setBlocks] = useState(false)
  const [draws, setDraws] = useState(false)
  const [lastDraw, setLastDraw] = useState<ToolDef>(DRAW[0])
  const draw = DRAW.find((d) => d.id === tool) ?? lastDraw
  const [at, setAt] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const shapesBox = useRef<HTMLDivElement>(null)
  const blocksBox = useRef<HTMLDivElement>(null)
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
  return (
    <div className="cv-bar" role="toolbar" aria-label="Canvas tools" ref={box}>
      {NAV.map(toolButton)}
      <span className="cv-sep" aria-hidden="true" />
      {PUT.map(toolButton)}
      <div className="cv-split" ref={shapesBox}>
        <button
          type="button"
          className={'cv-tool' + (tool === 'shape' ? ' on' : '')}
          aria-pressed={tool === 'shape'}
          aria-label={`Shape: ${SHAPE_LABEL[shapeKind]}`}
          title={`Shape: ${SHAPE_LABEL[shapeKind]} (R, X to change)`}
          onClick={() => onTool('shape')}
        >
          <ShapeIcon />
        </button>
        <button
          type="button"
          className="cv-tool cv-more"
          aria-label="Choose a shape"
          aria-haspopup="menu"
          aria-expanded={shapes}
          onClick={() => setShapes((m) => !m)}
        >
          <ChevronIcon />
        </button>
        {shapes && (
          <div className="cv-menu" role="menu">
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="menuitemradio"
                aria-checked={k === shapeKind}
                onClick={() => {
                  setShapes(false)
                  onShapeKind(k)
                  onTool('shape')
                }}
              >
                {SHAPE_LABEL[k]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="cv-split" ref={drawsBox}>
        {toolButton(draw)}
        <button
          type="button"
          className="cv-tool cv-more"
          aria-label="Choose a drawing tool"
          aria-haspopup="menu"
          aria-expanded={draws}
          onClick={() => setDraws((m) => !m)}
        >
          <ChevronIcon />
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
                <span>{d.label.replace(/ \(.*\)$/, '')}</span>
                <kbd>{d.key}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>
      {toolButton(FRAME)}
      <div className="cv-split" ref={blocksBox}>
        <button
          type="button"
          className="cv-tool"
          aria-label="Add a block"
          title="Heading, text, table, checklist, code"
          aria-haspopup="menu"
          aria-expanded={blocks}
          onClick={() => setBlocks((m) => !m)}
        >
          <BlockIcon />
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
        aria-label={arrangeLabel(ai)}
        title={`${arrangeLabel(ai)}: group the cards into sections; your own sections stay (Shift+T)`}
        onClick={onTidy}
      >
        <TidyIcon />
      </button>
      <span className="cv-sep" aria-hidden="true" />
      <button
        type="button"
        className="cv-tool narrow"
        aria-label="Zoom out"
        title="Zoom out (-)"
        onClick={() => onZoom(0.8)}
      >
        <span aria-hidden="true">-</span>
      </button>
      <button type="button" className="cv-zoom" title="Fit everything (Shift+1)" onClick={onFit}>
        {zoom}%
      </button>
      <button
        type="button"
        className="cv-tool narrow"
        aria-label="Zoom in"
        title="Zoom in (+)"
        onClick={() => onZoom(1.25)}
      >
        <span aria-hidden="true">+</span>
      </button>
      <span className="cv-sep" aria-hidden="true" />
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
