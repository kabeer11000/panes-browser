import { useEffect, useRef, useState } from 'react'
import './glow.css'

/**
 * The shortest time the light is up once it comes on: its arrival (~0.7 s, glow.css) and a beat after. Work that ends
 * sooner (a quick tidy, a board that turns out to be tidy already) still gets the whole gesture, never a blink.
 */
const MIN_ON_MS = 1100

/**
 * The board's "AI is working" light, after Siri's: a ring of flowing colour round the window's rounded edge (a line,
 * a glow and a haze), arriving at every edge at once. `level` 2 is the full light (the board is being arranged), 1 a calmer one (the model is still naming
 * what it made), 0 off. It fades out on its own before it unmounts. Only transforms and opacity animate, under fixed
 * ring masks, so the compositor runs it without repainting the board (see glow.css).
 */
export function AiGlow({ level }: { level: 0 | 1 | 2 }): React.JSX.Element | null {
  // An "off" that comes before MIN_ON_MS is held until then (an "on" meanwhile cancels it): the level that was on
  // stays shown while `holding`. The changes are noted while rendering; the clock runs in the effect.
  const [prev, setPrev] = useState(level)
  const [lastOn, setLastOn] = useState<1 | 2>(level || 2)
  const [holding, setHolding] = useState(false)
  if (level !== prev) {
    setPrev(level)
    if (level !== 0) {
      setLastOn(level)
      setHolding(false)
    } else if (prev > 0) setHolding(true)
  }
  const onAt = useRef<number | null>(null)
  useEffect(() => {
    if (level > 0) {
      onAt.current ??= performance.now()
      return
    }
    if (!holding) return
    const wait = Math.max(0, MIN_ON_MS - (performance.now() - (onAt.current ?? 0)))
    const t = setTimeout(() => {
      onAt.current = null
      setHolding(false)
    }, wait)
    return () => clearTimeout(t)
  }, [level, holding])
  const held = level > 0 ? level : holding ? lastOn : 0

  const [shown, setShown] = useState(held > 0)
  if (held > 0 && !shown) setShown(true)
  if (!shown) return null
  return (
    <div
      className={'cv-glow' + (held === 0 ? ' out' : held === 1 ? ' calm' : '')}
      aria-hidden="true"
      onAnimationEnd={(e) => {
        if (held === 0 && e.target === e.currentTarget) setShown(false)
      }}
    >
      <i>
        <b />
      </i>
      <i>
        <b />
      </i>
      <i>
        <b />
      </i>
    </div>
  )
}
