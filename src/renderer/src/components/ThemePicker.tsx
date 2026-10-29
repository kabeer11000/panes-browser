import { useRef, useState, type PointerEvent } from 'react'
import { harmonize, hexToHsl, tasteful, wheelDistance, type Scheme } from '../../../shared/color'
import { themeVars, type Theme } from './themeVars'

interface Props extends Theme {
  onChange: (patch: Partial<Theme>) => void
}

const SCHEMES: Array<{ id: Scheme; label: string; hint: string }> = [
  { id: 'single', label: 'Solo', hint: 'One colour' },
  { id: 'analogous', label: 'Analogous', hint: 'Neighbouring hues: calm and smooth' },
  { id: 'complementary', label: 'Complementary', hint: 'Opposite hues: bold contrast' },
  { id: 'triad', label: 'Triad', hint: 'Evenly spaced: lively and balanced' },
  { id: 'split', label: 'Split', hint: 'Softer contrast than complementary' },
  { id: 'free', label: 'Free', hint: 'Place both colours yourself' }
]

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

/** Position of a colour on the wheel, as percentages of the wheel box. */
function puckPos(hex: string): { left: string; top: string } {
  const { h } = hexToHsl(hex)
  const r = 0.2 + 0.8 * wheelDistance(hex) // the wheel's centre is a little saturated, so pucks never sit dead centre
  const rad = (h * Math.PI) / 180
  return { left: `${50 + 50 * r * Math.sin(rad)}%`, top: `${50 - 50 * r * Math.cos(rad)}%` }
}

/**
 * Arc-style theme editor. The wheel only yields tasteful colours (no greys, no neon, brightness
 * tuned per hue). A scheme row builds the second colour by colour harmony and keeps it in step
 * as you drag; "Free" lets you place both colours yourself. Intensity and grain are sliders.
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
  const [scheme, setScheme] = useState<Scheme>(color2 ? 'free' : 'single')
  const [active, setActive] = useState<1 | 2>(1)
  const editing = active === 2 && color2 ? 2 : 1

  const apply = (primary: string, mode: Scheme): void => {
    if (mode === 'single') onChange({ color: primary, color2: null })
    else if (mode === 'free') onChange({ color: primary })
    else onChange({ color: primary, color2: harmonize(primary, mode) })
  }

  const pickAt = (e: PointerEvent, which: 1 | 2): void => {
    const box = wheelRef.current?.getBoundingClientRect()
    if (!box) return
    const dx = e.clientX - (box.left + box.width / 2)
    const dy = e.clientY - (box.top + box.height / 2)
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
    // Map the outer 80% of the radius onto the allowed saturation range.
    const t = (Math.min(1, Math.hypot(dx, dy) / (box.width / 2)) - 0.2) / 0.8
    const hex = tasteful(h, t)
    if (which === 1) return apply(hex, scheme)
    setScheme('free') // moving the second colour by hand leaves the harmony
    onChange({ color2: hex })
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

  const chooseScheme = (next: Scheme): void => {
    setScheme(next)
    setActive(1)
    if (next === 'single') onChange({ color2: null })
    else if (next === 'free') {
      if (!color2) onChange({ color2: harmonize(color, 'analogous') })
    } else onChange({ color2: harmonize(color, next) })
  }

  return (
    <div className="tp">
      <div
        className="tp-preview themed"
        data-scheme={mode}
        style={themeVars({ color, color2, tint, grain, mode })}
      >
        <span>Preview</span>
      </div>

      <div className="tp-wheel-wrap">
        <div
          className="tp-wheel"
          ref={wheelRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          role="group"
          aria-label="Colour wheel"
        >
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
      </div>

      <div className="tp-schemes" role="radiogroup" aria-label="Interface mode">
        {(['dark', 'light'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={'tp-scheme' + (mode === m ? ' on' : '')}
            onClick={() => onChange({ mode: m })}
          >
            {m === 'dark' ? 'Dark' : 'Light'}
          </button>
        ))}
      </div>

      <div className="tp-schemes" role="radiogroup" aria-label="Colour scheme">
        {SCHEMES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={scheme === s.id}
            title={s.hint}
            className={'tp-scheme' + (scheme === s.id ? ' on' : '')}
            onClick={() => chooseScheme(s.id)}
          >
            {s.label}
          </button>
        ))}
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
              setScheme(p.color2 ? 'free' : 'single')
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
          onChange={(e) => onChange({ tint: Number(e.target.value) })}
        />
        <em>{Math.round((tint / 0.7) * 100)}%</em>
      </label>
      <label className="tp-slider">
        <span>Grain</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={grain}
          onChange={(e) => onChange({ grain: Number(e.target.value) })}
        />
        <em>{Math.round(grain * 100)}%</em>
      </label>
    </div>
  )
}
