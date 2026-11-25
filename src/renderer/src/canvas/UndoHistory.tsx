import { useRef } from 'react'
import { Presence } from '@renderer/components/Presence'
import { useDismiss } from './useDismiss'

const ago = (t: number): string => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

/** Undo steps shown in the menu; older ones are still there by Ctrl+Z. */
const STEPS_SHOWN = 8

/**
 * The board's undo history, beside the spaces in its top-left corner: a clock that lists the steps that can be taken
 * back, to go back to before any of them. (It used to sit inside the spaces menu, where nobody looked for it.)
 */
export function UndoHistory({
  open,
  onOpen,
  onClose,
  steps,
  onUndo
}: {
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** Steps that can be taken back, newest first (taken when the menu opens). */
  steps: Array<{ label: string; t: number }>
  /** Go back to before step `i` (0: the newest). */
  onUndo: (i: number) => void
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  useDismiss(open, host, onClose)
  return (
    <div className="cv-chip-host" ref={host}>
      <button
        type="button"
        className={'cv-hist-btn' + (open ? ' on' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Undo history"
        title="Undo history (Ctrl+Z goes back one step)"
        onClick={() => (open ? onClose() : onOpen())}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.6h2.6M8 5v3l2 1.5" />
        </svg>
      </button>
      <Presence>
        {open && (
          <div className="cv-menu cv-space-menu" role="menu" aria-label="Undo history">
            {steps.length === 0 ? (
              <p className="cv-hist-head">Nothing to undo yet</p>
            ) : (
              <>
                <p className="cv-hist-head">Go back to before</p>
                {steps.slice(0, STEPS_SHOWN).map((s, i) => (
                  <button
                    key={`${s.t}-${i}`}
                    type="button"
                    role="menuitem"
                    className="step"
                    onClick={() => {
                      onClose()
                      onUndo(i)
                    }}
                  >
                    <span>{s.label}</span>
                    <small>{ago(s.t)}</small>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </Presence>
    </div>
  )
}
