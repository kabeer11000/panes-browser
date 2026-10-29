import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { hexToHsl, tasteful, wheelDistance } from '../../../shared/color'

const GAP = 8.6
const DOT_R = 2.5

/** Position of a colour on the wheel, as percentages of the wheel box. */
function puckPos(hex: string): { left: string; top: string } {
  const { h } = hexToHsl(hex)
  const r = 0.2 + 0.8 * wheelDistance(hex) // the wheel's centre is a little saturated, so pucks never sit dead centre
  const rad = (h * Math.PI) / 180
  return { left: `${50 + 50 * r * Math.sin(rad)}%`, top: `${50 - 50 * r * Math.cos(rad)}%` }
}

/** The wheel itself: rings of small dots, hue around, saturation outward. Drawn once per size. */
function Dots({ size }: { size: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = ref.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    el.width = size * dpr
    el.height = size * dpr
    ctx.scale(dpr, dpr)
    const c = size / 2
    const R = c - DOT_R - 1
    for (let ring = 0; ring * GAP <= R; ring++) {
      const r = ring * GAP
      const n = ring === 0 ? 1 : Math.round((2 * Math.PI * r) / GAP)
      const t = Math.min(1, Math.max(0, (r / c - 0.2) / 0.8))
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 // from the top, clockwise: the same hue the pointer maths reads
        ctx.fillStyle = tasteful((a * 180) / Math.PI, t)
        ctx.beginPath()
        ctx.arc(c + r * Math.sin(a), c - r * Math.cos(a), DOT_R, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }, [size])
  return <canvas ref={ref} className="tp-dots" style={{ width: size, height: size }} />
}

interface Props {
  color: string
  /** A second colour gets its own, smaller puck. */
  color2?: string | null
  size?: number
  onChange: (patch: { color?: string; color2?: string }) => void
}

/**
 * Arc-style colour wheel: dots for hue and saturation, a puck per colour. It only yields tasteful
 * colours (no greys, no neon, lightness tuned per hue), so no spot on it is a bad choice.
 */
export function ColorWheel({
  color,
  color2 = null,
  size = 200,
  onChange
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<1 | 2>(1)
  // A second colour that has just appeared is the one you are about to place.
  const [hadSecond, setHadSecond] = useState(!!color2)
  if (!!color2 !== hadSecond) {
    setHadSecond(!!color2)
    setActive(color2 ? 2 : 1)
  }
  const editing = active === 2 && color2 ? 2 : 1

  const pickAt = (e: PointerEvent, which: 1 | 2): void => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const dx = e.clientX - (box.left + box.width / 2)
    const dy = e.clientY - (box.top + box.height / 2)
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
    // Map the outer 80% of the radius onto the allowed saturation range.
    const t = (Math.min(1, Math.hypot(dx, dy) / (box.width / 2)) - 0.2) / 0.8
    onChange(which === 1 ? { color: tasteful(h, t) } : { color2: tasteful(h, t) })
  }

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const hit = (e.target as HTMLElement).dataset.puck
    const which = hit === '1' || hit === '2' ? (Number(hit) as 1 | 2) : editing
    setActive(which)
    if (!hit) pickAt(e, which)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.buttons === 1) pickAt(e, editing)
  }

  return (
    <div
      className="tp-wheel"
      ref={ref}
      style={{ width: size, height: size }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      role="group"
      aria-label="Colour wheel"
    >
      <Dots size={size} />
      <span
        className={'tp-puck' + (editing === 1 ? ' on' : '')}
        data-puck="1"
        style={{ ...puckPos(color), background: color }}
      />
      {color2 && (
        <span
          className={'tp-puck small' + (editing === 2 ? ' on' : '')}
          data-puck="2"
          style={{ ...puckPos(color2), background: color2 }}
        />
      )}
    </div>
  )
}
