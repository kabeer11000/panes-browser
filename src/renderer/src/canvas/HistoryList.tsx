import { useEffect, useRef } from 'react'

interface Props {
  /** Newest first. */
  steps: Array<{ label: string; t: number }>
  /** Go back to before step `i` (0: the newest). */
  onPick: (i: number) => void
  onClose: () => void
}

const ago = (t: number): string => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

/** The steps that can be taken back, newest first; picking one takes back it and everything after it. */
export function HistoryList({ steps, onPick, onClose }: Props): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      if (!box.current?.parentElement?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [onClose])
  return (
    <div className="cv-menu cv-hist" role="menu" aria-label="Undo history" ref={box}>
      <p className="cv-hist-head">Go back to before</p>
      {steps.map((s, i) => (
        <button key={`${s.t}-${i}`} type="button" role="menuitem" onClick={() => onPick(i)}>
          <span>{s.label}</span>
          <small>{ago(s.t)}</small>
        </button>
      ))}
    </div>
  )
}
