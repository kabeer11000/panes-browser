import { useEffect, useRef } from 'react'
import type { Placement } from '@shared/ai/canvasItems'

const CHOICES: Array<{ id: Placement; label: string; hint: string }> = [
  { id: 'note', label: 'Turn into note', hint: 'Text you can edit, with a link back' },
  { id: 'document', label: 'Show as document', hint: 'Its content, here on the board' },
  { id: 'live', label: 'Open as live page', hint: 'The real page, in a tab, when opened' }
]

/** How a card is placed: as a note, a document or a live page. A quiet menu at the pointer. */
export function PlaceMenu({
  x,
  y,
  current,
  onPick,
  onClose
}: {
  x: number
  y: number
  current?: Placement
  onPick: (p: Placement) => void
  onClose: () => void
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector('button')?.focus()
    const down = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])
  return (
    <div className="cv-place-menu" ref={box} role="menu" style={{ left: x, top: y }}>
      {CHOICES.map((c) => (
        <button
          key={c.id}
          type="button"
          role="menuitemradio"
          aria-checked={current === c.id}
          className={current === c.id ? 'on' : ''}
          onClick={() => onPick(c.id)}
        >
          {c.label}
          <small>{c.hint}</small>
        </button>
      ))}
    </div>
  )
}
