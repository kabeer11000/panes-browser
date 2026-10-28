import { useEffect, useState } from 'react'
import {
  APPEARANCE_LIMITS,
  DEFAULT_SETTINGS,
  SEARCH_ENGINES,
  type AppearanceKey
} from '../../../../shared/settings'
import type { ClearKind, SearchEngineId, Settings as SettingsData } from '../../../../shared/types'

const ACCENTS = ['#8b8bff', '#5eb6ff', '#4ade80', '#fbbf24', '#fb7185', '#e879f9']

const CLEAR_OPTIONS: Array<{ kind: ClearKind; label: string }> = [
  { kind: 'history', label: 'Browsing history' },
  { kind: 'cookies', label: 'Cookies and site data' },
  { kind: 'cache', label: 'Cached files' },
  { kind: 'downloads', label: 'Download list' }
]

const RANGES: Array<{ label: string; ms: number | null }> = [
  { label: 'Last hour', ms: 3_600_000 },
  { label: 'Last 24 hours', ms: 86_400_000 },
  { label: 'Last 7 days', ms: 7 * 86_400_000 },
  { label: 'All time', ms: null }
]

function Toggle({
  on,
  onChange
}: {
  on: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={on}
      className={'toggle' + (on ? ' on' : '')}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  )
}

const SLIDERS: Array<{
  key: AppearanceKey
  label: string
  hint: string
  format: (v: number) => string
}> = [
  {
    key: 'uiScale',
    label: 'Interface size',
    hint: 'Text and icons in the sidebar and pane headers.',
    format: (v) => `${Math.round(v * 100)}%`
  },
  {
    key: 'density',
    label: 'Density',
    hint: 'Lower is thinner: smaller rows, buttons and spacing.',
    format: (v) => `${Math.round(v * 100)}%`
  },
  {
    key: 'sidebarWidth',
    label: 'Sidebar width',
    hint: 'How wide the tab sidebar is.',
    format: (v) => `${v}px`
  },
  {
    key: 'pageMargin',
    label: 'Page margin',
    hint: 'Space between the page and the window edge.',
    format: (v) => `${v}px`
  }
]

export function Settings(): React.JSX.Element {
  const [s, setS] = useState<SettingsData>(DEFAULT_SETTINGS)
  const [kinds, setKinds] = useState<Set<ClearKind>>(new Set(['history']))
  const [range, setRange] = useState(1)
  const [cleared, setCleared] = useState(false)

  useEffect(() => {
    void window.panesInternal.getSettings().then((v) => setS({ ...DEFAULT_SETTINGS, ...v }))
  }, [])

  const update = async (patch: Partial<SettingsData>): Promise<void> => {
    setS((prev) => ({ ...prev, ...patch })) // optimistic; main validates and echoes back
    setS({ ...DEFAULT_SETTINGS, ...(await window.panesInternal.setSettings(patch)) })
  }

  const toggleKind = (k: ClearKind): void =>
    setKinds((prev) => {
      const next = new Set(prev)
      if (!next.delete(k)) next.add(k)
      return next
    })

  const clear = async (): Promise<void> => {
    await window.panesInternal.clearData([...kinds], RANGES[range].ms)
    setCleared(true)
    setTimeout(() => setCleared(false), 2500)
  }

  return (
    <>
      <section className="int-section">
        <h2>Search</h2>
        <div className="int-field">
          <div>
            <div className="int-label">Search engine</div>
            <div className="int-sub">Used when you type something that is not a web address.</div>
          </div>
          <select
            value={s.searchEngine}
            onChange={(e) => void update({ searchEngine: e.target.value as SearchEngineId })}
          >
            {Object.entries(SEARCH_ENGINES).map(([id, e]) => (
              <option key={id} value={id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="int-section">
        <h2>On startup</h2>
        <div className="int-field">
          <div>
            <div className="int-label">When Panes opens</div>
            <div className="int-sub">Restore brings back the tabs you had open.</div>
          </div>
          <select
            value={s.startup}
            onChange={(e) => void update({ startup: e.target.value as SettingsData['startup'] })}
          >
            <option value="newtab">Open a new tab</option>
            <option value="restore">Restore previous tabs</option>
          </select>
        </div>
      </section>

      <section className="int-section">
        <h2>Interface size</h2>
        {SLIDERS.map((sl) => {
          const { min, max, step } = APPEARANCE_LIMITS[sl.key]
          return (
            <div key={sl.key} className="int-field">
              <div>
                <div className="int-label">{sl.label}</div>
                <div className="int-sub">{sl.hint}</div>
              </div>
              <div className="slider">
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={s[sl.key]}
                  onChange={(e) => void update({ [sl.key]: Number(e.target.value) })}
                />
                <span className="slider-value">{sl.format(s[sl.key])}</span>
              </div>
            </div>
          )
        })}
        <button
          className="int-btn small"
          onClick={() =>
            void update({
              uiScale: DEFAULT_SETTINGS.uiScale,
              density: DEFAULT_SETTINGS.density,
              sidebarWidth: DEFAULT_SETTINGS.sidebarWidth,
              pageMargin: DEFAULT_SETTINGS.pageMargin
            })
          }
        >
          Reset interface size
        </button>
      </section>

      <section className="int-section">
        <h2>Appearance</h2>
        <div className="int-field">
          <div>
            <div className="int-label">Accent colour</div>
            <div className="int-sub">Highlights, focus rings and the split view glow.</div>
          </div>
          <div className="swatches">
            {ACCENTS.map((c) => (
              <button
                key={c}
                className={'swatch' + (s.accent.toLowerCase() === c ? ' on' : '')}
                style={{ background: c }}
                aria-label={c}
                onClick={() => void update({ accent: c })}
              />
            ))}
            <input
              type="color"
              value={s.accent}
              aria-label="Custom accent colour"
              onChange={(e) => void update({ accent: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="int-section" id="privacy">
        <h2>Privacy</h2>
        <div className="int-field">
          <div>
            <div className="int-label">Block ads and trackers</div>
            <div className="int-sub">Filters requests at the network level on every site.</div>
          </div>
          <Toggle on={s.adblock} onChange={(v) => void update({ adblock: v })} />
        </div>

        <div className="int-field column">
          <div>
            <div className="int-label">Clear browsing data</div>
            <div className="int-sub">
              Choose what to remove. Cookies and cache are always cleared for all time.
            </div>
          </div>
          <div className="checks">
            {CLEAR_OPTIONS.map((o) => (
              <label key={o.kind}>
                <input
                  type="checkbox"
                  checked={kinds.has(o.kind)}
                  onChange={() => toggleKind(o.kind)}
                />
                {o.label}
              </label>
            ))}
          </div>
          <div className="clear-row">
            <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
              {RANGES.map((r, i) => (
                <option key={r.label} value={i}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              className="int-btn danger"
              disabled={kinds.size === 0}
              onClick={() => void clear()}
            >
              Clear data
            </button>
            {cleared && <span className="int-sub">Done.</span>}
          </div>
        </div>
      </section>

      <section className="int-section">
        <h2>Shortcuts</h2>
        <div className="shortcuts">
          {[
            ['Ctrl+T', 'New tab'],
            ['Ctrl+L', 'Address bar'],
            ['Ctrl+\\', 'Split view'],
            ['Alt+Shift+Arrows', 'Move focused pane'],
            ['Ctrl+Shift+A', 'All tabs'],
            ['Ctrl+scroll', 'Fly through tabs'],
            ['Ctrl+D', 'Bookmark'],
            ['Ctrl+F', 'Find in page'],
            ['Ctrl+H', 'History'],
            ['Ctrl+J', 'Downloads'],
            ['Ctrl+B', 'Toggle sidebar'],
            ['Ctrl +/-/0', 'Zoom'],
            ['F12', 'Developer tools']
          ].map(([k, label]) => (
            <div key={k}>
              <kbd>{k}</kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
