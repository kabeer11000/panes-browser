import { useEffect, useRef, useState } from 'react'
import { BOOST_FONTS, DEFAULT_THEME, withTheme } from '../../../shared/sitetheme'
import type { SiteInfo, SitePanelApi, SitePatch, SiteTheme } from '../../../shared/types'
import { ColorWheel } from '../components/ColorWheel'
import { BackIcon } from '../components/icons'
import { Row, Switch } from './ui'

type Tab = 'color' | 'font' | 'zap' | 'code'
const TABS: Array<[Tab, string]> = [
  ['color', 'Colour'],
  ['font', 'Font'],
  ['zap', 'Hide'],
  ['code', 'CSS']
]
const PRESETS = [
  '#ff7a59',
  '#ffb454',
  '#f2d94e',
  '#5fd68a',
  '#4cc9f0',
  '#3b82f6',
  '#8a6df0',
  '#ff7ac8'
]

const percent = (v: number): string => `${Math.round(v * 100)}%`

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <label className="pn-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--pct' as string]: `${((value - min) / (max - min)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <em>{percent(value)}</em>
    </label>
  )
}

/**
 * The boost editor: how this site looks in this space (dark page, a colour, a font, parts hidden, CSS). It edits
 * a draft of its own and streams it to the page, so the page restyles as a slider moves.
 */
export function Boost({
  api,
  info,
  send,
  onBack
}: {
  api: SitePanelApi
  info: SiteInfo
  send: (patch: SitePatch) => void
  onBack: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<SiteTheme>(info.boost ?? DEFAULT_THEME)
  const [css, setCss] = useState(info.boost?.css ?? '')
  const [tab, setTab] = useState<Tab>('color')
  // Hidden parts are added on the page (the picker), not here: the saved list is the one to show and keep.
  const zap = info.boost?.zap ?? []

  // Sliders and the wheel fire constantly; the page is restyled at most once per frame.
  const pending = useRef<SiteTheme | null>(null)
  const frame = useRef(0)
  const push = (next: SiteTheme): void => {
    setDraft(next)
    pending.current = next
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const t = pending.current
      pending.current = null
      if (t) send({ boost: t })
    })
  }
  const edit = (patch: Partial<SiteTheme>): void => push(withTheme({ ...draft, zap }, patch))

  // Typing CSS restyles the page once you pause.
  useEffect(() => {
    if (css === draft.css) return
    const t = setTimeout(() => edit({ css }), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [css])

  const reset = (): void => {
    setDraft(DEFAULT_THEME)
    setCss('')
    send({ boost: null })
  }

  return (
    <div className="pn-view" key="boost">
      <header className="pn-subhead">
        <button
          type="button"
          className="pn-back"
          onClick={onBack}
          aria-label="Back to site settings"
        >
          <BackIcon />
          Boost
        </button>
        {info.boost && (
          <button type="button" className="pn-chip-btn" onClick={reset}>
            Reset boost
          </button>
        )}
      </header>

      <nav className="pn-tabs" role="tablist" aria-label="Boost">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'on' : ''}
            onClick={() => setTab(id)}
          >
            {label}
            {id === 'zap' && zap.length > 0 && <i>{zap.length}</i>}
          </button>
        ))}
      </nav>

      <div className="pn-body" role="tabpanel">
        {tab === 'color' && (
          <>
            <div className="pn-group">
              <Row title="Dark page" hint="Inverts the page; pictures keep their colours">
                <Switch label="Dark page" on={draft.dark} onChange={(v) => edit({ dark: v })} />
              </Row>
            </div>
            <div className="pn-wheel" style={{ ['--tpc' as string]: draft.tint ?? 'transparent' }}>
              <ColorWheel
                color={draft.tint ?? '#8b8bff'}
                size={168}
                onChange={(p) => p.color && edit({ tint: p.color })}
              />
              <div className="pn-swatches" role="radiogroup" aria-label="Theme colour">
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.tint === null}
                  aria-label="No theme colour"
                  className={'pn-swatch none' + (draft.tint === null ? ' on' : '')}
                  onClick={() => edit({ tint: null })}
                />
                {PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={draft.tint === c}
                    aria-label={c}
                    className={'pn-swatch' + (draft.tint === c ? ' on' : '')}
                    style={{ background: c }}
                    onClick={() => edit({ tint: c })}
                  />
                ))}
              </div>
            </div>
            {draft.tint && (
              <Slider
                label="Strength"
                value={draft.strength}
                min={0.1}
                max={1}
                step={0.01}
                onChange={(v) => edit({ strength: v })}
              />
            )}
            <Slider
              label="Brightness"
              value={draft.brightness}
              min={0.6}
              max={1.4}
              step={0.01}
              onChange={(v) => edit({ brightness: v })}
            />
            <Slider
              label="Contrast"
              value={draft.contrast}
              min={0.6}
              max={1.4}
              step={0.01}
              onChange={(v) => edit({ contrast: v })}
            />
            <Slider
              label="Saturation"
              value={draft.saturation}
              min={0}
              max={2}
              step={0.01}
              onChange={(v) => edit({ saturation: v })}
            />
          </>
        )}

        {tab === 'font' && (
          <div className="pn-fonts" role="radiogroup" aria-label="Font">
            <button
              type="button"
              role="radio"
              aria-checked={draft.font === null}
              className={'pn-font' + (draft.font === null ? ' on' : '')}
              onClick={() => edit({ font: null })}
            >
              <b>Aa</b>
              <span>Site&apos;s own</span>
            </button>
            {Object.entries(BOOST_FONTS).map(([key, f]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={draft.font === key}
                className={'pn-font' + (draft.font === key ? ' on' : '')}
                onClick={() => edit({ font: key })}
              >
                <b style={{ fontFamily: f.stack }}>Aa</b>
                <span>{f.label}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'zap' && (
          <>
            <p className="pn-note">
              Hide parts of the page you do not want: banners, sidebars, popups. They stay hidden
              every time you visit {info.key} in {info.spaceName}.
            </p>
            <button type="button" className="pn-primary" onClick={() => api.pick()}>
              Choose something to hide
            </button>
            {zap.length === 0 ? (
              <p className="pn-note center">Nothing hidden yet.</p>
            ) : (
              <ul className="pn-zaps">
                {zap.map((sel) => (
                  <li key={sel}>
                    <code title={sel}>{sel}</code>
                    <button
                      type="button"
                      aria-label={`Show ${sel} again`}
                      onClick={() => send({ zapRemove: sel })}
                    >
                      Show
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'code' && (
          <>
            <p className="pn-note">
              Your own CSS for {info.key}, applied last. Only styles: it cannot run scripts.
            </p>
            <textarea
              className="pn-code"
              spellCheck={false}
              value={css}
              placeholder={'body { max-width: 760px; margin: 0 auto; }'}
              aria-label="Custom CSS"
              onChange={(e) => setCss(e.target.value)}
            />
          </>
        )}
      </div>
    </div>
  )
}
