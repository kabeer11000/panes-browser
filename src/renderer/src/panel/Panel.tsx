import { useCallback, useEffect, useRef, useState } from 'react'
import { PERM_LABEL, type PermDecision, type PermKind } from '../../../shared/permissions'
import { BOOST_FONTS, DEFAULT_THEME, withTheme } from '../../../shared/sitetheme'
import type { SiteInfo, SitePanelApi, SitePatch, SiteTheme } from '../../../shared/types'
import { ColorWheel } from '../components/ColorWheel'

declare global {
  interface Window {
    sitePanel: SitePanelApi
  }
}

type Tab = 'color' | 'font' | 'zap' | 'code' | 'site'
const TABS: Array<[Tab, string]> = [
  ['color', 'Colour'],
  ['font', 'Font'],
  ['zap', 'Hide'],
  ['code', 'CSS'],
  ['site', 'Site']
]

const PERM_KINDS: PermKind[] = [
  'camera',
  'microphone',
  'screen',
  'location',
  'notifications',
  'clipboard'
]
const CALL_KINDS: PermKind[] = ['camera', 'microphone', 'screen']
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
const DECISIONS: Array<{ id: PermDecision | 'ask'; label: string }> = [
  { id: 'ask', label: 'Ask' },
  { id: 'allow', label: 'Allow' },
  { id: 'block', label: 'Block' }
]

function Switch({
  on,
  label,
  disabled,
  onChange
}: {
  on: boolean
  label: string
  disabled?: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={'ss-switch' + (on ? ' on' : '')}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
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
      <em>{format(value)}</em>
    </label>
  )
}

const percent = (v: number): string => `${Math.round(v * 100)}%`

export function Panel(): React.JSX.Element | null {
  const api = window.sitePanel
  const [info, setInfo] = useState<SiteInfo | null>(null)
  const [draft, setDraft] = useState<SiteTheme>(DEFAULT_THEME)
  const [tab, setTab] = useState<Tab>('color')
  const [css, setCss] = useState('')
  const [cleared, setCleared] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    void api.info().then((i) => {
      setInfo(i)
      setDraft(i?.boost ?? DEFAULT_THEME)
      setCss(i?.boost?.css ?? '')
      setCleared(false)
    })
  }, [api])
  useEffect(() => {
    load()
    return api.onShow(load)
  }, [api, load])

  // The view is only as tall as the card, so it never covers page area it has no business covering.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => api.resize(el.getBoundingClientRect().height - 72))
    ro.observe(el)
    return () => ro.disconnect()
  }, [api, info])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') api.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api])

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
      if (t) void api.update({ boost: t })
    })
  }
  const edit = (patch: Partial<SiteTheme>): void => push(withTheme(draft, patch))

  // Typing CSS restyles the page once you pause.
  useEffect(() => {
    if (!info || css === draft.css) return
    const t = setTimeout(() => push(withTheme(draft, { css })), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [css])

  const send = (patch: SitePatch, optimistic?: (i: SiteInfo) => SiteInfo): void => {
    if (optimistic) setInfo((i) => (i ? optimistic(i) : i))
    void api.update(patch).then((i) => {
      if (i) setInfo(i)
    })
  }

  if (!info) return <div className="pn-root" />

  const boosted = !!info.boost
  const reset = (): void => {
    setDraft(DEFAULT_THEME)
    setCss('')
    void api.update({ boost: null }).then(setInfo)
  }

  return (
    <div className="pn-root" ref={box}>
      <div className="pn" role="dialog" aria-label="Site settings">
        <header className="pn-head">
          <div>
            <b>{info.key}</b>
            <span>
              <em>in {info.spaceName}</em>
            </span>
          </div>
          {boosted && (
            <button type="button" className="pn-reset" onClick={reset} title="Remove this boost">
              Reset boost
            </button>
          )}
        </header>

        <section className={'pn-secure ' + (info.secure ? 'ok' : 'bad')} aria-label="Connection">
          <span className="pn-secure-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              {info.secure ? (
                <path d="M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Zm-1.2 12.4-3-3 1.4-1.4 1.6 1.6 4-4 1.4 1.4-5.4 5.4Z" />
              ) : (
                <path d="M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Zm-1 5h2v5h-2V8Zm0 6.5h2v2h-2v-2Z" />
              )}
            </svg>
          </span>
          <div>
            <b>{info.secure ? 'Connection is secure' : 'Connection is not secure'}</b>
            <span>
              {info.secure
                ? 'What you send to this site is encrypted on the way.'
                : 'Others on the network could read or change what you send. Do not enter passwords or card numbers here.'}
            </span>
          </div>
          <div className="pn-secure-foot">
            <span>
              {info.cookies === 0
                ? 'No cookies'
                : `${info.cookies} cookie${info.cookies === 1 ? '' : 's'}`}
            </span>
            <button
              type="button"
              disabled={cleared}
              onClick={() => {
                setCleared(true)
                send({ clearData: true }, (i) => ({ ...i, cookies: 0 }))
              }}
              title="Forget this site's cookies and stored data. You may be signed out."
            >
              {cleared ? 'Cleared' : 'Clear site data'}
            </button>
          </div>
        </section>

        <nav className="pn-tabs" role="tablist" aria-label="Site settings">
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
              {id === 'zap' && draft.zap.length > 0 && <i>{draft.zap.length}</i>}
            </button>
          ))}
        </nav>

        <div className="pn-body">
          {tab === 'color' && (
            <>
              <div className="pn-row">
                <span>
                  Dark page
                  <em>Inverts the page; pictures keep their colours</em>
                </span>
                <Switch label="Dark page" on={draft.dark} onChange={(v) => edit({ dark: v })} />
              </div>

              <div
                className="pn-wheel"
                style={{ ['--tpc' as string]: draft.tint ?? 'transparent' }}
              >
                <ColorWheel
                  color={draft.tint ?? '#8b8bff'}
                  size={176}
                  onChange={(p) => p.color && edit({ tint: p.color })}
                />
                <div className="pn-swatches" role="radiogroup" aria-label="Theme colour">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.tint === null}
                    aria-label="No theme colour"
                    className={'ss-tint none' + (draft.tint === null ? ' on' : '')}
                    onClick={() => edit({ tint: null })}
                  />
                  {PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={draft.tint === c}
                      aria-label={c}
                      className={'ss-tint' + (draft.tint === c ? ' on' : '')}
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
                  format={percent}
                  onChange={(v) => edit({ strength: v })}
                />
              )}
              <Slider
                label="Brightness"
                value={draft.brightness}
                min={0.6}
                max={1.4}
                step={0.01}
                format={percent}
                onChange={(v) => edit({ brightness: v })}
              />
              <Slider
                label="Contrast"
                value={draft.contrast}
                min={0.6}
                max={1.4}
                step={0.01}
                format={percent}
                onChange={(v) => edit({ contrast: v })}
              />
              <Slider
                label="Saturation"
                value={draft.saturation}
                min={0}
                max={2}
                step={0.01}
                format={percent}
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
              <button type="button" className="pn-go" onClick={() => api.pick()}>
                Choose something to hide
              </button>
              {draft.zap.length === 0 ? (
                <p className="pn-empty">Nothing hidden yet.</p>
              ) : (
                <ul className="pn-zaps">
                  {draft.zap.map((sel) => (
                    <li key={sel}>
                      <code title={sel}>{sel}</code>
                      <button
                        type="button"
                        aria-label={`Show ${sel} again`}
                        title="Show it again"
                        onClick={() => {
                          setDraft(withTheme(draft, { zap: draft.zap.filter((z) => z !== sel) }))
                          send({ zapRemove: sel })
                        }}
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

          {tab === 'site' && (
            <>
              <div className="pn-row">
                <span>
                  Block ads and trackers
                  {!info.adblock.global && <em>Off for every site in Settings</em>}
                </span>
                <Switch
                  label="Block ads and trackers on this site"
                  on={info.adblock.global && !info.adblock.off}
                  disabled={!info.adblock.global}
                  onChange={(v) =>
                    send({ adblockOff: !v }, (i) => ({ ...i, adblock: { ...i.adblock, off: !v } }))
                  }
                />
              </div>
              {info.adblock.global && !info.adblock.off && (
                <div className="pn-row">
                  <span>
                    Hide ad spaces on the page
                    <em>
                      {info.adblock.blocked > 0
                        ? `${info.adblock.blocked} requests blocked here. Turn off if the page looks broken`
                        : 'Turn off if the page looks broken; ads stay blocked'}
                    </em>
                  </span>
                  <Switch
                    label="Hide ad spaces on this site"
                    on={info.adblock.cosmetic}
                    onChange={(v) =>
                      send({ adblockCosmetic: v }, (i) => ({
                        ...i,
                        adblock: { ...i.adblock, cosmetic: v }
                      }))
                    }
                  />
                </div>
              )}
              <div className="pn-row">
                <span>
                  Keep this site loaded
                  <em>The memory saver will not put its tab to sleep</em>
                </span>
                <Switch
                  label="Keep this site loaded"
                  on={info.keepLoaded}
                  onChange={(v) => send({ keepLoaded: v }, (i) => ({ ...i, keepLoaded: v }))}
                />
              </div>
              <div className="pn-title">Permissions</div>
              <button
                type="button"
                className="pn-allow-calls"
                onClick={() =>
                  send({ allowCalls: true }, (i) => ({
                    ...i,
                    perms: {
                      ...i.perms,
                      ...Object.fromEntries(CALL_KINDS.map((k) => [k, 'allow' as const]))
                    }
                  }))
                }
              >
                Allow camera, microphone and screen sharing
              </button>
              {PERM_KINDS.map((kind) => {
                const cur: PermDecision | 'ask' = info.perms[kind] ?? 'ask'
                return (
                  <div key={kind} className="pn-row">
                    <span>{PERM_LABEL[kind]}</span>
                    <div className="ss-seg" role="radiogroup" aria-label={PERM_LABEL[kind]}>
                      {DECISIONS.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          role="radio"
                          aria-checked={cur === d.id}
                          className={cur === d.id ? 'on' : ''}
                          onClick={() =>
                            send(
                              { perm: { kind, decision: d.id === 'ask' ? null : d.id } },
                              (i) => {
                                const perms = { ...i.perms }
                                if (d.id === 'ask') delete perms[kind]
                                else perms[kind] = d.id
                                return { ...i, perms }
                              }
                            )
                          }
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              <button type="button" className="ss-reset" onClick={() => send({ reset: true })}>
                Reset everything for this site
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
