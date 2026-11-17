import { useState } from 'react'
import './glow.css'

/**
 * The board's "AI is working" light, after Siri's: a ring of flowing colour round the window's rounded edge (a line,
 * a glow and a haze), arriving at every edge at once. `level` 2 is the full light (the board is being arranged), 1 a calmer one (the model is still naming
 * what it made), 0 off. It fades out on its own before it unmounts. Only transforms and opacity animate, under fixed
 * ring masks, so the compositor runs it without repainting the board (see glow.css).
 */
export function AiGlow({ level }: { level: 0 | 1 | 2 }): React.JSX.Element | null {
  const [shown, setShown] = useState(level > 0)
  if (level > 0 && !shown) setShown(true)
  if (!shown) return null
  return (
    <div
      className={'cv-glow' + (level === 0 ? ' out' : level === 1 ? ' calm' : '')}
      aria-hidden="true"
      onAnimationEnd={(e) => {
        if (level === 0 && e.target === e.currentTarget) setShown(false)
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
