import { useState } from 'react'
import {
  HEADING_MIN,
  isBlock,
  isShape,
  MARK_COLORS,
  TEXT_SIZES,
  type Align,
  type CanvasMark,
  type MarkPatch
} from '@shared/ai/canvasMarks'
import type { Box } from '@shared/ai/canvas'
import { TrashIcon } from './icons'

const SIZES = [12, 14, TEXT_SIZES.body, 20, TEXT_SIZES.heading, 40, 56]
const ALIGN: Array<{ how: Align; label: string }> = [
  { how: 'left', label: 'Align left' },
  { how: 'center', label: 'Align centres' },
  { how: 'right', label: 'Align right' },
  { how: 'top', label: 'Align top' },
  { how: 'middle', label: 'Align middles' },
  { how: 'bottom', label: 'Align bottom' }
]

interface Props {
  marks: CanvasMark[]
  /** The box around them, in board units: the bar sits above it (below, when there is no room above). */
  box: Box
  below: boolean
  /** How many things move on their own (a group counts once): align needs 2, distribute 3. */
  units: number
  onPatch: (p: MarkPatch) => void
  onAlign: (how: Align) => void
  onDistribute: (axis: 'x' | 'y') => void
  onGroup: (group: boolean) => void
  onOrder: (to: 'front' | 'back') => void
  onDuplicate: () => void
  onDelete: () => void
}

const sizeOf = (m: CanvasMark): number =>
  m.size ?? (m.kind === 'text' ? 20 : isBlock(m.kind) ? 14 : 16)

/**
 * The bar over selected drawings (shapes, text, blocks, lines): colour, outline, text size, arrange, group, lock,
 * delete. What it shows follows what is selected: outline only for shapes, size only where there is text.
 */
export function MarkBar({
  marks,
  box,
  below,
  units,
  onPatch,
  onAlign,
  onDistribute,
  onGroup,
  onOrder,
  onDuplicate,
  onDelete
}: Props): React.JSX.Element {
  const [menu, setMenu] = useState(false)
  const shapes = marks.filter((m) => isShape(m.kind))
  const texty = marks.filter((m) => !m.pts)
  const locked = marks.every((m) => m.locked)
  const grouped = marks.some((m) => m.group)
  const one = marks[0]
  const colour = marks.every(
    (m) => (isShape(m.kind) ? m.fill : m.color) === (isShape(one.kind) ? one.fill : one.color)
  )
    ? isShape(one.kind)
      ? one.fill
      : one.color
    : null
  const size = texty.length ? sizeOf(texty[0]) : null
  const step = (dir: 1 | -1): void => {
    if (size === null) return
    const next = dir > 0 ? SIZES.find((v) => v > size) : SIZES.findLast((v) => v < size)
    if (next !== undefined) onPatch({ size: next })
  }
  return (
    <div
      className={'cv-fbar cv-mbar' + (below ? ' below' : '')}
      style={{ left: box.x + box.w / 2, top: below ? box.y + box.h : box.y }}
      role="toolbar"
      aria-label="Drawing"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {!locked && (
        <>
          {Array.from({ length: MARK_COLORS }, (_, c) => (
            <button
              key={c}
              type="button"
              className={'cv-swatch' + (colour === c ? ' on' : '')}
              style={{ '--fc': `var(--m${c})` } as React.CSSProperties}
              aria-label={`Colour ${c + 1}`}
              title="Colour"
              // a shape takes the colour as its fill and outline; a line, text or block as its ink
              onClick={() => onPatch(shapes.length ? { fill: c, color: c } : { color: c })}
            />
          ))}
          {shapes.length > 0 && (
            <>
              <button
                type="button"
                className={'cv-swatch none' + (colour === -1 ? ' on' : '')}
                aria-label="No fill"
                title="No fill"
                onClick={() => onPatch({ fill: -1 })}
              />
              <span className="cv-ksep" aria-hidden="true" />
              <button
                type="button"
                className={'cv-kbtn wide' + (shapes.every((m) => m.stroke !== false) ? ' on' : '')}
                aria-pressed={shapes.every((m) => m.stroke !== false)}
                title="Outline"
                onClick={() => onPatch({ stroke: !shapes.every((m) => m.stroke !== false) })}
              >
                Outline
              </button>
            </>
          )}
          {size !== null && (
            <>
              <span className="cv-ksep" aria-hidden="true" />
              <button
                type="button"
                className="cv-kbtn"
                aria-label="Smaller text"
                title="Smaller text"
                onClick={() => step(-1)}
              >
                <span aria-hidden="true">A-</span>
              </button>
              <span className="cv-msize" title="Text size">
                {size >= HEADING_MIN ? 'Heading' : size}
              </span>
              <button
                type="button"
                className="cv-kbtn"
                aria-label="Larger text"
                title="Larger text"
                onClick={() => step(1)}
              >
                <span aria-hidden="true">A+</span>
              </button>
            </>
          )}
          <span className="cv-ksep" aria-hidden="true" />
          <div className="cv-mmenu-host">
            <button
              type="button"
              className={'cv-kbtn wide' + (menu ? ' on' : '')}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
            >
              Arrange
            </button>
            {menu && (
              <div className="cv-menu cv-mmenu" role="menu" onClick={() => setMenu(false)}>
                {ALIGN.map((a) => (
                  <button
                    key={a.how}
                    type="button"
                    role="menuitem"
                    disabled={units < 2}
                    onClick={() => onAlign(a.how)}
                  >
                    {a.label}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  disabled={units < 3}
                  onClick={() => onDistribute('x')}
                >
                  Space evenly across
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={units < 3}
                  onClick={() => onDistribute('y')}
                >
                  Space evenly down
                </button>
                <button type="button" role="menuitem" onClick={() => onOrder('front')}>
                  Bring to front
                </button>
                <button type="button" role="menuitem" onClick={() => onOrder('back')}>
                  Send to back
                </button>
                <button type="button" role="menuitem" onClick={onDuplicate}>
                  Duplicate <small>Ctrl+D</small>
                </button>
              </div>
            )}
          </div>
          {(marks.length > 1 || grouped) && (
            <button
              type="button"
              className="cv-kbtn wide"
              title={grouped ? 'Ungroup (Ctrl+Shift+G)' : 'Group (Ctrl+G)'}
              onClick={() => onGroup(!grouped)}
            >
              {grouped ? 'Ungroup' : 'Group'}
            </button>
          )}
        </>
      )}
      <button
        type="button"
        className={'cv-kbtn wide' + (locked ? ' on' : '')}
        aria-pressed={locked}
        title={locked ? 'Unlock' : 'Lock in place'}
        onClick={() => onPatch({ locked: !locked })}
      >
        {locked ? 'Unlock' : 'Lock'}
      </button>
      {!locked && (
        <button
          type="button"
          className="cv-kbtn"
          aria-label="Delete"
          title="Delete"
          onClick={onDelete}
        >
          <TrashIcon />
        </button>
      )}
    </div>
  )
}
