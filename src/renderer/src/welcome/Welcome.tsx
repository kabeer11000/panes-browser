import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { chromeVars } from '@shared/color'
import { resolveMode, type PerformanceMode } from '@shared/performance'
import { DEFAULT_SETTINGS, SEARCH_ENGINES, SPACE_LOOKS } from '@shared/settings'
import type { MemoryStats, SearchEngineId, Settings, Space, SpaceMode } from '@shared/types'
import { Segmented, Toggle } from '@renderer/internal/ui'
import { ImportSection } from '@renderer/internal/pages/ImportSection'
import { preloadImportSources } from '@renderer/internal/pages/importSources'
import { AiStep } from './AiStep'

const STEPS = ['welcome', 'import', 'look', 'layout', 'speed', 'ai', 'finish'] as const
type Step = (typeof STEPS)[number]

const KEYS: Array<[string, string]> = [
  ['Ctrl T', 'New tab'],
  ['Ctrl L', 'Search or type an address'],
  ['Ctrl Tab', 'Fly through your tabs'],
  ['Ctrl \\', 'Split the page in two'],
  ['Ctrl B', 'Hide or show the sidebar'],
  ['Ctrl Shift K', 'Open the canvas board']
]

/** The tour is always dark (it fills the window on its own), in the colours of the space being set up. */
function wear(space: Space, accentSetting: string): void {
  const root = document.documentElement.style
  for (const [k, v] of Object.entries(
    chromeVars(space, true, accentSetting, DEFAULT_SETTINGS.accent)
  ))
    root.setProperty(k, v)
  root.removeProperty('--stage-bg')
}

function Panes(): React.JSX.Element {
  return (
    <div className="wl-mark" aria-hidden="true">
      <span className="p1" />
      <span className="p2" />
      <span className="p3" />
    </div>
  )
}

/** The downloads bin, small: a bucket with a file standing in it, as it peeks out of the window's corner. */
function BinArt(): React.JSX.Element {
  return (
    <div className="wl-bin" aria-hidden="true">
      <svg viewBox="0 0 52 52">
        <defs>
          <linearGradient id="wl-wall" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0"
              style={{ stopColor: 'color-mix(in srgb, var(--accent) 58%, white)' }}
            />
            <stop
              offset="1"
              style={{ stopColor: 'color-mix(in srgb, var(--accent) 82%, black)' }}
            />
          </linearGradient>
        </defs>
        <ellipse cx="26" cy="17" rx="20" ry="6" fill="rgb(0 0 0 / 0.4)" />
        <rect className="wl-bin-file" x="17" y="3" width="18" height="24" rx="3.5" />
        <path
          d="M6 17 A20 6 0 0 0 46 17 L42 45.5 Q41.4 49 37.5 49 H14.5 Q10.6 49 10 45.5 Z"
          fill="url(#wl-wall)"
        />
        <path
          d="M6 17 A20 6 0 0 0 46 17"
          stroke="rgb(255 255 255 / 0.6)"
          strokeWidth="1.4"
          fill="none"
        />
        <path
          d="M14 24 L16.4 43"
          stroke="rgb(255 255 255 / 0.3)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

const ROW_OPACITY = [1, 0.6, 0.6]
const SETTLE = { type: 'spring', stiffness: 480, damping: 24 } as const

/**
 * A tiny drawing of a layout. Choosing it plays it: the tabs drop into place one after another (down the side, or
 * along the top) and the page settles in beside them, so the choice shows what it does.
 */
function LayoutArt({
  kind,
  on
}: {
  kind: 'vertical' | 'horizontal'
  on: boolean
}): React.JSX.Element {
  const vertical = kind === 'vertical'
  const axis = vertical ? 'x' : 'y' // the way the tabs run: down the side, or along the top
  const from = vertical ? -16 : -12
  return (
    <div className={'wl-art ' + kind} aria-hidden="true">
      {!vertical && (
        <motion.i
          className="bar"
          animate={on ? { scaleX: [0.3, 1], opacity: [0, 0.4] } : { scaleX: 1, opacity: 0.4 }}
          transition={{ ...SETTLE, delay: on ? 0.2 : 0 }}
        />
      )}
      {ROW_OPACITY.map((opacity, i) => (
        <motion.i
          key={i}
          className={`row r${i + 1}`}
          animate={on ? { [axis]: [from, 0], opacity: [0, opacity] } : { [axis]: 0, opacity }}
          transition={{ ...SETTLE, delay: on ? i * 0.07 : 0 }}
        />
      ))}
      <motion.i
        className="page"
        animate={on ? { scale: [0.92, 1], opacity: [0.3, 0.9] } : { scale: 1, opacity: 0.9 }}
        transition={{ ...SETTLE, delay: on ? 0.12 : 0 }}
      />
    </div>
  )
}

/** The canvas board, tiny: cards land on it one after another and a section gathers two of them. */
const CANVAS_CARDS = [
  { cls: 'c1', from: { x: -10, y: -8 } },
  { cls: 'c2', from: { x: 10, y: -10 } },
  { cls: 'c3', from: { x: -8, y: 10 } },
  { cls: 'c4', from: { x: 12, y: 8 } }
] as const

function CanvasArt({ on }: { on: boolean }): React.JSX.Element {
  return (
    <div className="wl-art canvas" aria-hidden="true">
      <motion.i
        className="section"
        animate={on ? { scale: [0.9, 1], opacity: [0, 1] } : { scale: 1, opacity: 1 }}
        transition={{ ...SETTLE, delay: on ? 0.3 : 0 }}
      />
      {CANVAS_CARDS.map((c, i) => (
        <motion.i
          key={c.cls}
          className={`card ${c.cls}`}
          animate={
            on
              ? { x: [c.from.x, 0], y: [c.from.y, 0], opacity: [0, 0.9] }
              : { x: 0, y: 0, opacity: 0.9 }
          }
          transition={{ ...SETTLE, delay: on ? i * 0.07 : 0 }}
        />
      ))}
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
    void api.getSettings().then(setS)
    void api.spacesList().then((list) => setSpace(list[0] ?? null))
    void api.memoryStats().then(setStats)
    preloadImportSources() // the next step lists them: look while this one is read
    const check = (): void => void api.defaultBrowserStatus().then(setIsDefault)
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [api])

  // the page wears the space's colours, and changes with them as they are picked
  const accentSetting = s?.accent
  useEffect(() => {
    if (space && accentSetting) wear(space, accentSetting)
  }, [space, accentSetting])

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
  }

  const needsRestart =
    !!s &&
    !!stats &&
    resolveMode(s.performanceMode, stats.totalGb * 1024 ** 3) !== stats.runningMode
  const finish = async (): Promise<void> => {
    await api.onboardingDone()
    if (needsRestart) void api.restart()
  }
  const forward = (): void => {
    if (step === 'finish') void finish()
    else go(STEPS[index + 1])
  }

  // Enter or the arrow keys move through the steps, unless a control on the step has the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t !== document.body && !t.classList.contains('wl-step')) return
      if (e.key === 'Enter' || e.key === 'ArrowRight') forward()
      else if (e.key === 'ArrowLeft' && index > 0) go(STEPS[index - 1])
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Each step takes the keyboard as it arrives (Tab goes on into it) and starts scrolled to its top.
  const arrive = useCallback((el: HTMLElement | null) => {
    if (!el) return
    el.focus({ preventScroll: true })
    el.parentElement?.scrollTo({ top: 0 })
  }, [])

  if (!s || !space) return <></>
  const recommended = stats ? resolveMode('auto', stats.totalGb * 1024 ** 3) : 'balanced'

  return (
    <MotionConfig reducedMotion="user">
      <main className="wl">
        <header className="wl-top">
          <div className="wl-dots" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
            {STEPS.map((st, i) => (
              <button
                key={st}
                type="button"
                className={'wl-dot' + (i === index ? ' on' : i < index ? ' done' : '')}
                aria-label={`Go to step ${i + 1}`}
                aria-current={i === index ? 'step' : undefined}
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
              ref={arrive}
              tabIndex={-1}
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
                  <button type="button" className="wl-go" onClick={forward}>
                    Get started
                  </button>
                </>
              )}

              {step === 'import' && (
                <>
                  <h1>Bring your things along</h1>
                  <p className="wl-lede">
                    Bookmarks, history and passwords from the browser you use now. Or skip this and
                    do it later in Settings.
                  </p>
                  <div className="wl-import">
                    <ImportSection />
                  </div>
                </>
              )}

              {step === 'look' && (
                <>
                  <h1>Make it yours</h1>
                  <p className="wl-lede">Pick a colour and a mood.</p>
                  <div className="wl-swatches" role="radiogroup" aria-label="Colour">
                    {SPACE_LOOKS.map((l) => (
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
                  <p className="wl-note">
                    Light or dark takes over once you start browsing. You can make more spaces
                    later, each with its own look.
                  </p>
                </>
              )}

              {step === 'layout' && (
                <>
                  <h1>Where do your tabs go?</h1>
                  <p className="wl-lede">
                    Change this any time in Settings, or per space. Ctrl Shift K opens the canvas
                    from anywhere.
                  </p>
                  <div className="wl-cards three" role="radiogroup" aria-label="Tab layout">
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
                        aria-checked={s.browseWith !== 'canvas' && s.tabLayout === value}
                        className={
                          'wl-card' +
                          (s.browseWith !== 'canvas' && s.tabLayout === value ? ' on' : '')
                        }
                        onClick={() => update({ tabLayout: value, browseWith: 'tabs' })}
                      >
                        <LayoutArt
                          kind={value}
                          on={s.browseWith !== 'canvas' && s.tabLayout === value}
                        />
                        <b>{title}</b>
                        <span>{hint}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={s.browseWith === 'canvas'}
                      className={'wl-card' + (s.browseWith === 'canvas' ? ' on' : '')}
                      onClick={() => update({ browseWith: 'canvas' })}
                    >
                      <CanvasArt on={s.browseWith === 'canvas'} />
                      <b>On a canvas</b>
                      <span>Every tab a card on one board, grouped by topic</span>
                    </button>
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
                        <em>
                          Puts tabs you are not using to sleep, and wakes them when you return.
                        </em>
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

              {step === 'ai' && <AiStep ai={s.ai} update={update} />}

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
                  <div className="wl-dock">
                    <BinArt />
                    <p>
                      <b>Your downloads wait in the corner.</b> A bucket peeks out of the
                      bottom-right edge of the window: point there to bring it out, and click it to
                      see what you have downloaded.
                    </p>
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
                </>
              )}
            </motion.section>
          </AnimatePresence>
        </div>

        {/* the way on stays in one place on every step, so it is on screen however short the window */}
        {step !== 'welcome' && (
          <footer className="wl-nav">
            <button type="button" className="wl-back" onClick={() => go(STEPS[index - 1])}>
              Back
            </button>
            <button type="button" className="wl-next" onClick={forward}>
              {step !== 'finish'
                ? 'Continue'
                : needsRestart
                  ? 'Start browsing (restarts once)'
                  : 'Start browsing'}
            </button>
          </footer>
        )}
      </main>
    </MotionConfig>
  )
}
