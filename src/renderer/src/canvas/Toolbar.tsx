import { useRef, useState } from 'react'
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
  TidyIcon
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

const TOOLS: Array<{ id: Tool; label: string; key: string; icon: React.JSX.Element }> = [
  {
    id: 'select',
    label: 'Select (Shift and drag inside a section to select in it)',
    key: 'V',
    icon: <SelectIcon />
  },
  { id: 'hand', label: 'Hand (or hold Space)', key: 'H', icon: <HandIcon /> },
  { id: 'frame', label: 'Frame (or Alt and drag)', key: 'F', icon: <FrameIcon /> },
  { id: 'note', label: 'Sticky note', key: 'S', icon: <NoteIcon /> },
  { id: 'text', label: 'Text', key: 'T', icon: <TextIcon /> },
  {
    id: 'connector',
    label: 'Connector (or drag a dot on an object)',
    key: 'C',
    icon: <ConnectorIcon />
  },
  { id: 'line', label: 'Line', key: 'L', icon: <LineIcon /> },
  { id: 'pen', label: 'Pen', key: 'P', icon: <PenIcon /> },
  { id: 'marker', label: 'Highlighter', key: 'M', icon: <MarkerIcon /> }
]

interface Props {
  tool: Tool
  zoom: number
  busy: boolean
  /** The prompt is searching or the model is answering. */
  finding: boolean
  /** An answer is open above the bar: the box asks follow-ups. */
  asking?: boolean
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
  promptRef,
  shapeKind,
  onShapeKind,
  onBlock,
  mentionable,
  onMention,
  onPrompt,
  onTool,
  onTidy,
  onFit,
  onZoom
}: Props): React.JSX.Element {
  const [shapes, setShapes] = useState(false)
  const [blocks, setBlocks] = useState(false)
  const [at, setAt] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  return (
    <div className="cv-bar" role="toolbar" aria-label="Canvas tools" ref={box}>
      {TOOLS.map((t) => (
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
      ))}
      <div className="cv-split">
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
      <div className="cv-split">
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
      <form
        className={'cv-prompt ai-edge' + (finding ? ' finding on' : '') + (asking ? ' asking' : '')}
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
          placeholder={asking ? 'Ask a follow-up' : 'Ask anything'}
          aria-label={asking ? 'Ask a follow-up' : 'Ask anything'}
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
      <button
        type="button"
        className={'cv-tidy' + (busy ? ' busy' : '')}
        title="Tidy: arrange everything neatly (Shift+T)"
        onClick={onTidy}
      >
        <TidyIcon />
        <span>Tidy</span>
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
    </div>
  )
}
