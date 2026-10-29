import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { harmonize, hexToHsl, tasteful, wheelDistance } from '../../../shared/color'
import type { SpaceMode } from '../../../shared/types'
import { type Theme } from './themeVars'

interface Props extends Theme {
  onChange: (patch: Partial<Theme>) => void
}

interface Preset {
  color: string
  color2: string | null
  tint?: number
  mode?: 'dark' | 'light'
  label?: string
}

const NEUTRAL = '#8b8b95'
const PRESETS: Preset[] = [
  { color: NEUTRAL, color2: null, tint: 0, mode: 'dark', label: 'Neutral dark' },
  { color: NEUTRAL, color2: null, tint: 0, mode: 'light', label: 'Neutral light' },
  { color: '#6e7bff', color2: '#a46bff' },
  { color: '#2bb3a3', color2: '#4ea0ff' },
  { color: '#e5754c', color2: '#f2b24c' },
  { color: '#d65b9a', color2: '#7a5cff' },
  { color: '#34d399', color2: '#06b6d4' },
  { color: '#f87171', color2: '#fb923c' },
  { color: '#8a6df0', color2: null },
  { color: '#3b82f6', color2: null }
]

const WHEEL = 200 // css px
const DOT_GAP = 8.6
const DOT_R = 2.5

/** Position of a colour on the wheel, as percentages of the wheel box. */
function puckPos(hex: string): { left: string; top: string } {
  const { h } = hexToHsl(hex)
  const r = 0.2 + 0.8 * wheelDistance(hex) // the wheel's centre is a little saturated, so pucks never sit dead centre
  const rad = (h * Math.PI) / 180
  return { left: `${50 + 50 * r * Math.sin(rad)}%`, top: `${50 - 50 * r * Math.cos(rad)}%` }
}

/** The wheel itself: rings of small dots, hue around, saturation outward. Drawn once. */
function DotWheel(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = ref.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    el.width = WHEEL * dpr
    el.height = WHEEL * dpr
    ctx.scale(dpr, dpr)
    const c = WHEEL / 2
    const R = c - DOT_R - 1
    for (let ring = 0; ring * DOT_GAP <= R; ring++) {
      const r = ring * DOT_GAP
      const n = ring === 0 ? 1 : Math.round((2 * Math.PI * r) / DOT_GAP)
      const t = Math.min(1, Math.max(0, (r / c - 0.2) / 0.8))
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 // from the top, clockwise: the same hue the pointer maths reads
        ctx.fillStyle = tasteful((a * 180) / Math.PI, t)
        ctx.beginPath()
        ctx.arc(c + r * Math.sin(a), c - r * Math.cos(a), DOT_R, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }, [])
  return <canvas ref={ref} className="tp-dots" style={{ width: WHEEL, height: WHEEL }} />
}

const MODES: Array<{ id: SpaceMode; label: string; path: string }> = [
  {
    id: 'system',
    label: 'Match system',
    path: 'M3 5h18v11H3zM8 20h8M12 16v4'
  },
  {
    id: 'light',
    label: 'Light',
    path: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'
  },
  { id: 'dark', label: 'Dark', path: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z' }
]

/**
 * Arc-style theme editor: a wheel of dots to place one or two colours on, then how strongly they
 * tint the window and how much film grain sits on top. The wheel only yields tasteful colours (no
 * greys, no neon, brightness tuned per hue). Light, dark or following the system sits at the top.
 */
export function ThemePicker({
  color,
  color2,
  tint,
  grain,
  mode,
  onChange
}: Props): React.JSX.Element {
  const wheelRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<1 | 2>(1)
  const editing = active === 2 && color2 ? 2 : 1

  const pickAt = (e: PointerEvent, which: 1 | 2): void => {
    const box = wheelRef.current?.getBoundingClientRect()
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
    <div className="tp" style={{ ['--tpc' as string]: color }}>
      <div className="tp-head">
        <span className="tp-title">Color</span>
        <div className="tp-modes" role="radiogroup" aria-label="Interface mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              aria-label={m.label}
              title={m.label}
              className={'tp-mode' + (mode === m.id ? ' on' : '')}
              onClick={() => onChange({ mode: m.id })}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={m.path} />
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div className="tp-panel">
        <div
          className="tp-wheel"
          ref={wheelRef}
          style={{ width: WHEEL, height: WHEEL }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          role="group"
          aria-label="Colour wheel"
        >
          <DotWheel />
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
        <button
          type="button"
          className="tp-add"
          onClick={() => {
            if (color2) {
              setActive(1)
              onChange({ color2: null })
            } else {
              setActive(2)
              onChange({ color2: harmonize(color, 'analogous') })
            }
          }}
        >
          <span aria-hidden="true">{color2 ? '−' : '+'}</span>
          {color2 ? 'Remove second color' : 'Add second color'}
        </button>
      </div>

      <div className="tp-presets" role="group" aria-label="Presets">
        {PRESETS.map((p) => (
          <button
            key={p.label ?? p.color + (p.color2 ?? '')}
            type="button"
            className={'tp-preset' + (p.mode ? ' neutral ' + p.mode : '')}
            title={p.label}
            aria-label={p.label ?? `Theme ${p.color}${p.color2 ? ` to ${p.color2}` : ''}`}
            style={{
              background: p.mode
                ? p.mode === 'dark'
                  ? '#26262e'
                  : '#f1f1f6'
                : p.color2
                  ? `linear-gradient(135deg, ${p.color}, ${p.color2})`
                  : p.color
            }}
            onClick={() => {
              setActive(1)
              onChange({
                color: p.color,
                color2: p.color2,
                ...(p.tint !== undefined && { tint: p.tint }),
                ...(p.mode && { mode: p.mode })
              })
            }}
          />
        ))}
      </div>

      <label className="tp-slider">
        <span>Intensity</span>
        <input
          type="range"
          min={0}
          max={0.7}
          step={0.01}
          value={tint}
          style={{ ['--pct' as string]: `${(tint / 0.7) * 100}%` }}
          onChange={(e) => onChange({ tint: Number(e.target.value) })}
        />
        <em>{Math.round((tint / 0.7) * 100)}%</em>
      </label>
      <label className="tp-slider">
        <span>Texture</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={grain}
          style={{ ['--pct' as string]: `${grain * 100}%` }}
          onChange={(e) => onChange({ grain: Number(e.target.value) })}
        />
        <em>{Math.round(grain * 100)}%</em>
      </label>
    </div>
  )
}
