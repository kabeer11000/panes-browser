import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { resolveMode, type PerformanceMode } from '../../../shared/performance'
import { SEARCH_ENGINES } from '../../../shared/settings'
import type { MemoryStats, SearchEngineId, Settings, Space, SpaceMode } from '../../../shared/types'
import { Segmented, Toggle } from '../internal/ui'

const STEPS = ['welcome', 'look', 'layout', 'speed', 'finish'] as const
type Step = (typeof STEPS)[number]

/** Colour pairs offered on the look step: the same ones the space editor has as presets. */
const LOOKS: Array<{ name: string; color: string; color2: string | null }> = [
  { name: 'Indigo', color: '#6e7bff', color2: '#a46bff' },
  { name: 'Lagoon', color: '#2bb3a3', color2: '#4ea0ff' },
  { name: 'Sunset', color: '#e5754c', color2: '#f2b24c' },
  { name: 'Orchid', color: '#d65b9a', color2: '#7a5cff' },
  { name: 'Mint', color: '#34d399', color2: '#06b6d4' },
  { name: 'Coral', color: '#f87171', color2: '#fb923c' },
  { name: 'Violet', color: '#8a6df0', color2: null },
  { name: 'Sky', color: '#3b82f6', color2: null }
]

const KEYS: Array<[string, string]> = [
  ['Ctrl T', 'New tab'],
  ['Ctrl L', 'Search or type an address'],
  ['Ctrl Tab', 'Fly through your tabs'],
  ['Ctrl \\', 'Split the page in two'],
  ['Ctrl B', 'Hide or show the sidebar']
]

function Panes(): React.JSX.Element {
  return (
    <div className="wl-mark" aria-hidden="true">
      <span className="p1" />
      <span className="p2" />
      <span className="p3" />
    </div>
  )
}

/** Tiny drawings of the two layouts, so the choice shows what it does. */
function LayoutArt({ kind }: { kind: 'vertical' | 'horizontal' }): React.JSX.Element {
  return (
    <div className={'wl-art ' + kind} aria-hidden="true">
      <i className="bar" />
      <i className="row r1" />
      <i className="row r2" />
      <i className="row r3" />
      <i className="page" />
    </div>
  )
}

export function Welcome(): React.JSX.Element {
  const api = window.panesInternal
  const [step, setStep] = useState<Step>('welcome')
  const [dir, setDir] = useState(1)
  const [s, setS] = useState<Settings | null>(null)
  const [space, setSpace] = useState<Space | null>(null)
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [isDefault, setIsDefault] = useState(false)

  useEffect(() => {
    void api.getSettings().then((v) => {
      setS(v)
      const { chromeVars } = v as unknown as { chromeVars?: Record<string, string> }
      const root = document.documentElement.style
      for (const [k, val] of Object.entries(chromeVars ?? {})) root.setProperty(k, val)
      root.removeProperty('--stage-bg')
    })
    void api.spacesList().then((list) => setSpace(list[0] ?? null))
    void api.memoryStats().then(setStats)
    const check = (): void => void api.defaultBrowserStatus().then(setIsDefault)
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [api])

  const index = STEPS.indexOf(step)
  const go = (to: Step): void => {
    setDir(STEPS.indexOf(to) > index ? 1 : -1)
    setStep(to)
  }
  const update = (patch: Partial<Settings>): void => {
    setS((prev) => (prev ? { ...prev, ...patch } : prev))
    void api.setSettings(patch)
  }
  const updateSpace = (patch: Partial<Space>): void => {
    if (!space) return
    setSpace({ ...space, ...patch })
    void api.spaceUpdate(space.id, patch)
    // the page wears the space's colour too, straight away
    if (patch.color) document.documentElement.style.setProperty('--space', patch.color)
  }

  const needsRestart =
    !!s &&
    !!stats &&
    resolveMode(s.performanceMode, stats.totalGb * 1024 ** 3) !== stats.runningMode
  const finish = async (): Promise<void> => {
    await api.onboardingDone()
    if (needsRestart) void api.restart()
  }

  if (!s || !space) return <></>
  const recommended = stats ? resolveMode('auto', stats.totalGb * 1024 ** 3) : 'balanced'

  return (
    <main className="wl">
      <header className="wl-top">
        <div className="wl-dots" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
          {STEPS.map((st, i) => (
            <button
              key={st}
              type="button"
              className={'wl-dot' + (i === index ? ' on' : i < index ? ' done' : '')}
              aria-label={`Go to step ${i + 1}`}
              onClick={() => go(st)}
            />
          ))}
        </div>
        {step !== 'finish' && (
          <button type="button" className="wl-skip" onClick={() => void finish()}>
            Skip
          </button>
        )}
      </header>

      <div className="wl-stage">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.section
            key={step}
            className="wl-step"
            initial={{ opacity: 0, x: 36 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -36 * dir }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            {step === 'welcome' && (
              <>
                <Panes />
                <h1>Welcome to Panes</h1>
                <p className="wl-lede">
                  A calm, fast browser built around the way you work: tabs you can see, pages side
                  by side, and nothing in your way.
                </p>
                <button type="button" className="wl-go" onClick={() => go('look')}>
                  Get started
                </button>
              </>
            )}

            {step === 'look' && (
              <>
                <h1>Make it yours</h1>
                <p className="wl-lede">
                  Pick a colour and a mood. The window behind this page changes with you.
                </p>
                <div className="wl-swatches" role="radiogroup" aria-label="Colour">
                  {LOOKS.map((l) => (
                    <button
                      key={l.name}
                      type="button"
                      role="radio"
                      aria-checked={space.color === l.color}
                      aria-label={l.name}
                      title={l.name}
                      className={'wl-swatch' + (space.color === l.color ? ' on' : '')}
                      style={{
                        background: l.color2
                          ? `linear-gradient(135deg, ${l.color}, ${l.color2})`
                          : l.color
                      }}
                      onClick={() => updateSpace({ color: l.color, color2: l.color2 })}
                    />
                  ))}
                </div>
                <Segmented<SpaceMode>
                  label="Appearance"
                  value={space.mode}
                  options={[
                    { value: 'system', label: 'Match my system' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' }
                  ]}
                  onChange={(mode) => updateSpace({ mode })}
                />
                <p className="wl-note">You can make more spaces later, each with its own look.</p>
              </>
            )}

            {step === 'layout' && (
              <>
                <h1>Where do your tabs go?</h1>
                <p className="wl-lede">Change this any time in Settings.</p>
                <div className="wl-cards" role="radiogroup" aria-label="Tab layout">
                  {(
                    [
                      ['vertical', 'In a sidebar', 'Titles you can read, spaces at the bottom'],
                      ['horizontal', 'Along the top', 'The classic row, with spaces at the left']
                    ] as const
                  ).map(([value, title, hint]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={s.tabLayout === value}
                      className={'wl-card' + (s.tabLayout === value ? ' on' : '')}
                      onClick={() => update({ tabLayout: value })}
                    >
                      <LayoutArt kind={value} />
                      <b>{title}</b>
                      <span>{hint}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 'speed' && (
              <>
                <h1>Fast and private</h1>
                <p className="wl-lede">Good defaults, ready to change.</p>
                <div className="wl-list">
                  <div className="wl-row">
                    <span>
                      Block ads and trackers
                      <em>
                        Built in, on every site. Switch it off for one site from the address bar.
                      </em>
                    </span>
                    <Toggle
                      label="Block ads and trackers"
                      on={s.adblock}
                      onChange={(v) => update({ adblock: v })}
                    />
                  </div>
                  <div className="wl-row">
                    <span>
                      Memory saver
                      <em>Puts tabs you are not using to sleep, and wakes them when you return.</em>
                    </span>
                    <Toggle
                      label="Memory saver"
                      on={s.memorySaver}
                      onChange={(v) => update({ memorySaver: v })}
                    />
                  </div>
                  <div className="wl-row col">
                    <span>
                      Performance
                      <em>
                        {stats
                          ? `This computer has ${stats.totalGb} GB of memory, so Auto picks ${recommended === 'efficient' ? 'Efficient' : 'Balanced'}.`
                          : 'Efficient shares one process between tabs of a site.'}
                      </em>
                    </span>
                    <Segmented<PerformanceMode>
                      label="Performance"
                      value={s.performanceMode}
                      options={[
                        { value: 'auto', label: 'Auto' },
                        { value: 'balanced', label: 'Balanced' },
                        { value: 'efficient', label: 'Efficient' }
                      ]}
                      onChange={(v) => update({ performanceMode: v })}
                    />
                  </div>
                  <div className="wl-row col">
                    <span>Search with</span>
                    <Segmented<SearchEngineId>
                      label="Search engine"
                      value={s.searchEngine}
                      options={(Object.keys(SEARCH_ENGINES) as SearchEngineId[]).map((id) => ({
                        value: id,
                        label: SEARCH_ENGINES[id].name
                      }))}
                      onChange={(v) => update({ searchEngine: v })}
                    />
                  </div>
                </div>
              </>
            )}

            {step === 'finish' && (
              <>
                <Panes />
                <h1>You are all set</h1>
                <div className="wl-default">
                  {isDefault ? (
                    <span className="wl-ok">Panes is your default browser</span>
                  ) : (
                    <button
                      type="button"
                      className="wl-ghost"
                      onClick={() => void api.defaultBrowserRequest()}
                    >
                      Make Panes my default browser
                    </button>
                  )}
                </div>
                <dl className="wl-keys">
                  {KEYS.map(([k, label]) => (
                    <div key={k}>
                      <dt>
                        {k.split(' ').map((part) => (
                          <kbd key={part}>{part}</kbd>
                        ))}
                      </dt>
                      <dd>{label}</dd>
                    </div>
                  ))}
                </dl>
                <button type="button" className="wl-go" onClick={() => void finish()}>
                  {needsRestart ? 'Start browsing (restarts once)' : 'Start browsing'}
                </button>
              </>
            )}
          </motion.section>
        </AnimatePresence>
      </div>

      {step !== 'welcome' && step !== 'finish' && (
        <footer className="wl-nav">
          <button type="button" className="wl-back" onClick={() => go(STEPS[index - 1])}>
            Back
          </button>
          <button type="button" className="wl-next" onClick={() => go(STEPS[index + 1])}>
            Continue
          </button>
        </footer>
      )}
    </main>
  )
}
