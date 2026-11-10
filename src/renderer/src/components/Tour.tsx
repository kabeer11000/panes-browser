import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cardSpot, TOUR_STEPS } from '@shared/tour'

type Box = { x: number; y: number; w: number; h: number }

/**
 * The first target of a step that is really on screen now: the element itself is what shows at its middle (a copy in
 * the hidden hover sidebar, parked off the edge or under the page, is not). The tour lets the pointer through, so
 * it does not hide what it looks for.
 */
function findTarget(selectors: string[] | undefined): Box | null {
  for (const sel of selectors ?? []) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4 || r.x < 0 || r.y < 0 || r.right > innerWidth) continue
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      if (top && (top === el || el.contains(top)))
        return { x: r.x, y: r.y, w: r.width, h: r.height }
    }
  }
  return null
}

/**
 * The guided tour over the window: the part each step is about stays lit in a dimmed window, with a card beside it.
 * The page views step aside for its time (they would cover anything drawn over the page area).
 */
export function Tour({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight })
  const card = useRef<HTMLDivElement>(null)
  const [cardSize, setCardSize] = useState({ w: 320, h: 170 })
  const step = TOUR_STEPS[i]
  const last = i === TOUR_STEPS.length - 1

  useEffect(() => {
    void window.api.setOverlay(true)
    return () => void window.api.setOverlay(false)
  }, [])
  useLayoutEffect(() => {
    const look = (): void => {
      setBox(findTarget(step.target))
      setSize({ w: innerWidth, h: innerHeight })
      const c = card.current
      if (c) setCardSize({ w: c.offsetWidth, h: c.offsetHeight })
    }
    look()
    addEventListener('resize', look)
    return () => removeEventListener('resize', look)
  }, [step])
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (last) onClose()
        else setI((n) => n + 1)
      } else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  }, [last, onClose])

  const pad = 6
  const lit = box && { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }
  const at = cardSpot(lit, cardSize, size)
  // on the page's own top level: above every stacking layer of the window's interface
  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label="Tour of Panes">
      <div
        className={'tour-lit' + (lit ? '' : ' none')}
        style={lit ? { left: lit.x, top: lit.y, width: lit.w, height: lit.h } : undefined}
      />
      <div className="tour-card" ref={card} style={{ left: at.x, top: at.y }} key={step.id}>
        <span className="tour-n">
          {i + 1} / {TOUR_STEPS.length}
        </span>
        <b>{step.title}</b>
        <p>{step.body}</p>
        {step.keys && <kbd>{step.keys}</kbd>}
        <div className="tour-acts">
          <button type="button" className="tour-skip" onClick={onClose}>
            {last ? 'Close' : 'Skip'}
          </button>
          {i > 0 && (
            <button type="button" onClick={() => setI((n) => n - 1)}>
              Back
            </button>
          )}
          <button
            type="button"
            className="primary"
            autoFocus
            onClick={() => (last ? onClose() : setI((n) => n + 1))}
          >
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
