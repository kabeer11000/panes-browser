import { harmonize, maxSafeTint } from '../../../shared/color'
import type { SpaceMode } from '../../../shared/types'
import { ColorWheel } from './ColorWheel'
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
  // The strongest tint that keeps text readable; "system" has to hold in both schemes.
  const safe = Math.min(
    mode === 'light' ? 1 : maxSafeTint(color, color2, true),
    mode === 'dark' ? 1 : maxSafeTint(color, color2, false)
  )
  const shown = Math.min(tint, safe)
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
        <ColorWheel color={color} color2={color2} onChange={onChange} />
        <button
          type="button"
          className="tp-add"
          onClick={() => {
            if (color2) {
              onChange({ color2: null })
            } else {
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
          value={shown}
          style={{ ['--pct' as string]: `${(shown / 0.7) * 100}%` }}
          onChange={(e) => onChange({ tint: Math.min(Number(e.target.value), safe) })}
          title={safe < 0.7 ? 'Limited so text stays readable on this colour' : undefined}
        />
        <em>{Math.round((shown / 0.7) * 100)}%</em>
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
