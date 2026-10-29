import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PERM_LABEL, type PermDecision, type PermKind } from '../../../shared/permissions'
import { DEFAULT_STRENGTH } from '../../../shared/sitetheme'
import type { SiteInfo, SitePatch, SiteTheme } from '../../../shared/types'

const KINDS: PermKind[] = ['camera', 'microphone', 'location', 'notifications', 'clipboard']
const TINTS = [
  '#ff7a59',
  '#ffb454',
  '#f2d94e',
  '#5fd68a',
  '#4cc9f0',
  '#7a8cff',
  '#c77dff',
  '#ff7ac8'
]
const WIDTH = 320

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

const DECISIONS: Array<{ id: PermDecision | 'ask'; label: string }> = [
  { id: 'ask', label: 'Ask' },
  { id: 'allow', label: 'Allow' },
  { id: 'block', label: 'Block' }
]

interface Props {
  /** The button that opened this: the panel hangs under it. */
  anchor: DOMRect
  onClose: () => void
}

/**
 * Everything for the page you are on, in one place: its ad blocker exception, its boost in this space,
 * whether it may be unloaded, and what it may access. Opened from the address bar.
 */
export function SiteSettings({ anchor, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [info, setInfo] = useState<SiteInfo | null>(null)

  useEffect(() => {
    void window.api.siteInfo().then(setInfo)
  }, [])

  // Page views are native and paint over this, so the page is swapped for its snapshot while it is open;
  // and the window's drag regions stop swallowing the click that dismisses it.
  useEffect(() => {
    const opened = window.api.setOverlay(true)
    document.documentElement.classList.add('popover-open')
    return () => {
      document.documentElement.classList.remove('popover-open')
      void opened.then(() => window.api.setOverlay(false))
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: globalThis.PointerEvent): void => {
      const t = e.target as HTMLElement
      if (!ref.current?.contains(t) && !t.closest('.addr-site')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [onClose])

  const send = (patch: SitePatch, optimistic?: (i: SiteInfo) => SiteInfo): void => {
    if (optimistic) setInfo((i) => (i ? optimistic(i) : i))
    void window.api.siteUpdate(patch).then(setInfo)
  }

  const left = Math.max(8, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - 8))
  const top = anchor.bottom + 8
  const boost: SiteTheme = info?.boost ?? { dark: false, tint: null, strength: DEFAULT_STRENGTH }
  const setBoost = (next: SiteTheme): void =>
    send({ boost: next }, (i) => ({ ...i, boost: next.dark || next.tint ? next : null }))

  return createPortal(
    <div
      ref={ref}
      className="ss"
      role="dialog"
      aria-label="Site settings"
      style={{ left, top, width: WIDTH }}
    >
      {!info ? (
        <div className="ss-empty">Loading...</div>
      ) : (
        <div className="ss-scroll">
          <div className="ss-head">
            <b>{info.key}</b>
            <span className={info.secure ? 'ok' : 'bad'}>
              {info.secure ? 'Connection is secure' : 'Connection is not secure'}
            </span>
          </div>

          <div className="ss-block">
            <div className="ss-row">
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
            <div className="ss-row">
              <span>
                Keep this site loaded
                <em>The memory saver will not unload its tab</em>
              </span>
              <Switch
                label="Keep this site loaded"
                on={info.keepLoaded}
                onChange={(v) => send({ keepLoaded: v }, (i) => ({ ...i, keepLoaded: v }))}
              />
            </div>
          </div>

          <div className="ss-block">
            <div className="ss-title">
              Boost <em>in {info.spaceName}</em>
            </div>
            <div className="ss-row">
              <span>Dark mode</span>
              <Switch
                label="Dark mode for this site"
                on={boost.dark}
                onChange={(v) => setBoost({ ...boost, dark: v })}
              />
            </div>
            <div className="ss-row stack">
              <span>Tint</span>
              <div className="ss-tints" role="radiogroup" aria-label="Tint">
                <button
                  type="button"
                  role="radio"
                  aria-checked={boost.tint === null}
                  aria-label="No tint"
                  className={'ss-tint none' + (boost.tint === null ? ' on' : '')}
                  onClick={() => setBoost({ ...boost, tint: null })}
                />
                {TINTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={boost.tint === c}
                    aria-label={`Tint ${c}`}
                    className={'ss-tint' + (boost.tint === c ? ' on' : '')}
                    style={{ background: c }}
                    onClick={() => setBoost({ ...boost, tint: c })}
                  />
                ))}
              </div>
            </div>
            {boost.tint && (
              <label className="ss-row slider">
                <span>Strength</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={boost.strength}
                  style={{ ['--pct' as string]: `${((boost.strength - 0.1) / 0.9) * 100}%` }}
                  onChange={(e) => setBoost({ ...boost, strength: Number(e.target.value) })}
                />
              </label>
            )}
          </div>

          <div className="ss-block">
            <div className="ss-title">Permissions</div>
            {KINDS.map((kind) => {
              const cur: PermDecision | 'ask' = info.perms[kind] ?? 'ask'
              return (
                <div key={kind} className="ss-row">
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
                          send({ perm: { kind, decision: d.id === 'ask' ? null : d.id } }, (i) => {
                            const perms = { ...i.perms }
                            if (d.id === 'ask') delete perms[kind]
                            else perms[kind] = d.id
                            return { ...i, perms }
                          })
                        }
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          <button type="button" className="ss-reset" onClick={() => send({ reset: true })}>
            Reset everything for this site
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}
