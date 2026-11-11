import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cardSpot, matchCombo, TOUR_STEPS, type KeyLike } from '@shared/tour'

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
 * A step that has a shortcut is done by pressing it. While the tour is up main hands it every modified key
 * (setTourOpen / onTourKey) instead of running the feature, so the window does not change under the tour; the target
 * gives a confirming pulse, and the tour moves on by itself.
 * The page views step aside for its time (they would cover anything drawn over the page area).
 */
export function Tour({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight })
  const [done, setDone] = useState(false) // the step's shortcut was just pressed: a beat of acknowledgement
  const card = useRef<HTMLDivElement>(null)
  const [cardSize, setCardSize] = useState({ w: 320, h: 170 })
  const step = TOUR_STEPS[i]
  const last = i === TOUR_STEPS.length - 1
  const isMac = window.api.platform === 'darwin'

  // the beat between a pressed shortcut and the next step: cleared by any other move, and on close
  const beat = useRef(0)
  const go = (to: number): void => {
    window.clearTimeout(beat.current)
    setDone(false)
    if (to >= TOUR_STEPS.length) onClose()
    else setI(Math.max(0, to))
  }

  useEffect(() => {
    void window.api.setOverlay(true)
    window.api.setTourOpen(true)
    return () => {
      window.clearTimeout(beat.current)
      window.api.setTourOpen(false)
      void window.api.setOverlay(false)
    }
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

  // The keys: the step's own shortcut completes it (caught, not performed); arrows and Esc move through or end it.
  // The shortcut comes from main (onTourKey), or as a key event here for one main has no use for.
  const combo = (e: KeyLike): boolean => {
    if (!step.keys || !matchCombo(step.keys, e, isMac)) return false
    if (!done) {
      setDone(true)
      const next = i + 1
      window.clearTimeout(beat.current)
      beat.current = window.setTimeout(() => go(next), 820)
    }
    return true // pressed again during the beat: swallowed too, never the real feature
  }
  const comboRef = useRef(combo)
  useLayoutEffect(() => {
    comboRef.current = combo
  })
  useEffect(() => window.api.onTourKey((e) => void comboRef.current(e)), [])
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') return onClose()
      if (comboRef.current(e)) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (done) return // the beat runs out by itself
      if (e.key === 'ArrowRight' || e.key === 'Enter') go(i + 1)
      else if (e.key === 'ArrowLeft') go(i - 1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
    // `go` is made anew each render from i and onClose, both listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, done, onClose])

  const pad = 6
  const lit = box && { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }
  const at = cardSpot(lit, cardSize, size)
  const progress = ((i + (done ? 1 : 0)) / (TOUR_STEPS.length - 1)) * 100
  // on the page's own top level: above every stacking layer of the window's interface
  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label="Tour of Panes">
      <div
        className={'tour-lit' + (lit ? '' : ' none') + (done ? ' done' : '')}
        style={lit ? { left: lit.x, top: lit.y, width: lit.w, height: lit.h } : undefined}
      >
        {done && (
          <svg className="tour-tick" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <div className="tour-card" ref={card} style={{ left: at.x, top: at.y }} key={step.id}>
        <div className="tour-bar" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </div>
        <span className="tour-n">
          {i + 1} / {TOUR_STEPS.length}
        </span>
        <b>{step.title}</b>
        <p>{step.body}</p>
        {step.keys && (
          <div className={'tour-cue' + (done ? ' ok' : '')}>
            {done ? (
              <span className="tour-cue-ok">Nice — that is the one</span>
            ) : (
              <>
                <kbd>{step.keys}</kbd>
                <span>{step.cue}</span>
              </>
            )}
          </div>
        )}
        <div className="tour-acts">
          <button type="button" className="tour-skip" onClick={onClose}>
            {last ? 'Close' : 'Skip tour'}
          </button>
          {i > 0 && (
            <button type="button" onClick={() => go(i - 1)}>
              Back
            </button>
          )}
          <button type="button" className="primary" autoFocus onClick={() => go(i + 1)}>
            {last ? 'Done' : step.keys ? 'Skip' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
