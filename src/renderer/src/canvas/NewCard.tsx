import { useEffect, useRef } from 'react'
import { NoteIcon, SearchGlyph } from './icons'

interface Props {
  /** Where it opens, in the board's root coordinates. */
  x: number
  y: number
  onOpen: (text: string) => void
  onNote: () => void
  onClose: () => void
}

/**
 * Something new on the board, where the person asked for it (double-click, the New button, Ctrl+T): an address or
 * a search opens as a real tab whose card lands at that spot, or a note.
 */
export function NewCard({ x, y, onOpen, onNote, onClose }: Props): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLFormElement>(null)
  useEffect(() => {
    input.current?.focus()
    const away = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [onClose])
  return (
    <form
      ref={box}
      className="cv-new"
      style={{ left: x, top: y }}
      onSubmit={(e) => {
        e.preventDefault()
        const v = input.current?.value.trim() ?? ''
        if (v) onOpen(v)
        else onClose()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="cv-new-row">
        <SearchGlyph />
        <input
          ref={input}
          type="text"
          placeholder="Address or search"
          aria-label="Open an address or search on the board"
          autoComplete="off"
          spellCheck={false}
          maxLength={2000}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') onClose()
          }}
        />
        <kbd aria-hidden="true">Enter</kbd>
      </div>
      <div className="cv-new-row actions">
        <button type="button" className="cv-new-note" onClick={onNote}>
          <NoteIcon />
          Add a note
        </button>
        <span className="cv-new-hint">or paste a link onto the board</span>
      </div>
    </form>
  )
}
