import { useRef } from 'react'
import type { Space } from '@shared/types'
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
 * The board's one control in its top-left corner: the space you are in (its colour and name), quiet until pointed
 * at. It opens a menu of your spaces to switch to, a new space, and the steps that can be taken back.
 */
export function SpaceChip({
  spaces,
  activeId,
  open,
  onOpen,
  onClose,
  steps,
  onUndo
}: {
  spaces: Space[]
  activeId: number
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** Steps that can be taken back, newest first (taken when the menu opens). */
  steps: Array<{ label: string; t: number }>
  /** Go back to before step `i` (0: the newest). */
  onUndo: (i: number) => void
}): React.JSX.Element | null {
  const host = useRef<HTMLDivElement>(null)
  useDismiss(open, host, onClose)
  const active = spaces.find((s) => s.id === activeId)
  if (!active) return null
  const pick = (run: () => void) => (): void => {
    onClose()
    run()
  }
  return (
    <div className="cv-chip-host" ref={host}>
      <button
        type="button"
        className={'cv-space-chip' + (open ? ' on' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Spaces and undo history"
        onClick={() => (open ? onClose() : onOpen())}
      >
        <i style={{ background: active.color }} aria-hidden="true" />
        <span>{active.name}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 4 5 6.5 7.5 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      {open && (
        <div className="cv-menu cv-space-menu" role="menu" aria-label="Spaces and undo history">
          <p className="cv-hist-head">Spaces</p>
          {spaces.map((sp) => (
            <button
              key={sp.id}
              type="button"
              role="menuitemradio"
              aria-checked={sp.id === activeId}
              className={sp.id === activeId ? 'here' : ''}
              onClick={pick(() => sp.id !== activeId && window.api.switchSpace(sp.id))}
            >
              <i style={{ background: sp.color }} aria-hidden="true" />
              <span>{sp.name}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="add"
            onClick={pick(() => window.api.createSpace())}
          >
            <i aria-hidden="true">+</i>
            <span>New space</span>
          </button>
          {steps.length > 0 && (
            <>
              <hr />
              <p className="cv-hist-head">Go back to before</p>
              {steps.slice(0, STEPS_SHOWN).map((s, i) => (
                <button
                  key={`${s.t}-${i}`}
                  type="button"
                  role="menuitem"
                  className="step"
                  onClick={pick(() => onUndo(i))}
                >
                  <span>{s.label}</span>
                  <small>{ago(s.t)}</small>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
