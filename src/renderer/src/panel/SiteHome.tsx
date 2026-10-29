import { useState } from 'react'
import { ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN } from '../../../shared/memory'
import {
  describeKinds,
  PERM_LABEL,
  type PermKind,
  type PermSetting
} from '../../../shared/permissions'
import { DEFAULT_THEME } from '../../../shared/sitetheme'
import type { SiteInfo, SitePatch, SitePerm } from '../../../shared/types'
import {
  ChevronIcon,
  CloseIcon,
  GlobeIcon,
  IncognitoIcon,
  ReloadIcon,
  ShieldIcon,
  TorIcon
} from '../components/icons'
import { LockGlyph, PermIcon, Row, Section, Segmented, Switch, type Choice } from './ui'

/** Shown whether or not the page has asked; the rest appear once they matter (set, asked, or in use). */
const EVERYDAY: readonly PermKind[] = ['camera', 'microphone', 'location', 'notifications']

const CHOICES: readonly Choice<PermSetting>[] = [
  { id: 'ask', label: 'Ask' },
  { id: 'allow', label: 'Allow' },
  { id: 'block', label: 'Block' }
]
// Screen sharing always goes through the picker, so Allow would mean the same as Ask.
const SCREEN_CHOICES = CHOICES.filter((c) => c.id !== 'allow')

const time = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const day = (ms: number): string =>
  new Date(ms).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })

function inUse(kind: PermKind, info: SiteInfo): boolean {
  if (kind === 'camera') return info.capture.camera
  if (kind === 'microphone') return info.capture.mic
  return kind === 'screen' && info.capture.screen
}

/** The line under a permission: what is happening with it on this page right now, most pressing first. */
function permHint(p: SitePerm, info: SiteInfo): { text: string; tone?: 'live' | 'warn' } | null {
  if (inUse(p.kind, info)) return { text: 'In use now', tone: 'live' }
  if (info.reload.includes(p.kind)) return { text: 'Reload the page to apply', tone: 'warn' }
  if (p.until !== null && p.until > Date.now())
    return { text: `This time only, until ${time(p.until)}` }
  if (p.asked === 'refused')
    return { text: p.setting === 'block' ? 'Blocked on this page' : 'Refused on this page' }
  if (p.asked === 'granted') return { text: 'Used by this page' }
  if (p.kind === 'screen' && p.setting !== 'block')
    return { text: 'You pick what to share each time' }
  return null
}

function SiteMark({ info }: { info: SiteInfo }): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  // A Tor tab's icon is not fetched again from here: this view is outside Tor, and the request would leave it.
  const icon = info.tabKind !== 'tor' && info.favicon !== failed ? info.favicon : null
  return (
    <span className="pn-mark" aria-hidden="true">
      {icon ? <img src={icon} alt="" onError={() => setFailed(icon)} /> : <GlobeIcon />}
    </span>
  )
}

/** Asks once more before something that cannot be undone. */
function Confirm({
  text,
  action,
  onConfirm,
  onCancel
}: {
  text: string
  action: string
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="pn-confirm" role="alertdialog" aria-label={text}>
      <p>{text}</p>
      <div>
        {/* Focus starts on Cancel: a second Enter must not do the thing that cannot be undone. */}
        <button type="button" className="pn-btn" autoFocus onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="pn-btn danger" onClick={onConfirm}>
          {action}
        </button>
      </div>
    </div>
  )
}

/** The site at a glance: who it is, what it may use, and what Panes does for it. */
export function SiteHome({
  info,
  send,
  onBoost,
  onClose
}: {
  info: SiteInfo
  send: (patch: SitePatch, optimistic?: (i: SiteInfo) => SiteInfo) => void
  onBoost: () => void
  onClose: () => void
}): React.JSX.Element {
  const [certOpen, setCertOpen] = useState(false)
  const [allPerms, setAllPerms] = useState(false)
  const [confirm, setConfirm] = useState<'clear' | 'reset' | null>(null)
  const [cleared, setCleared] = useState(false)

  const setPerm = (kind: PermKind, setting: PermSetting): void =>
    send({ perm: { kind, decision: setting === 'ask' ? null : setting } }, (i) => ({
      ...i,
      perms: i.perms.map((p) => (p.kind === kind ? { ...p, setting, until: null } : p))
    }))
  const reload = (): void => {
    setCleared(false)
    send({ reload: true })
  }
  const zoomTo = (level: number): void => {
    const zoom = Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, level))
    send({ zoom }, (i) => ({ ...i, zoom }))
  }

  const shown = info.perms.filter(
    (p) =>
      allPerms ||
      EVERYDAY.includes(p.kind) ||
      p.setting !== 'ask' ||
      p.asked !== null ||
      inUse(p.kind, info)
  )
  const hiddenCount = info.perms.length - shown.length
  const allowed = info.perms.filter((p) => p.setting === 'allow').length
  const blocked = info.perms.filter((p) => p.setting === 'block').length
  const summary =
    allowed + blocked === 0
      ? 'Asks for everything'
      : [allowed && `${allowed} allowed`, blocked && `${blocked} blocked`]
          .filter(Boolean)
          .join(', ')
  const dark = info.boost?.dark ?? false
  const adblockOn = info.adblock.global && !info.adblock.off
  const zoomPct = Math.round(1.2 ** info.zoom * 100)
  const reloadText =
    info.reload.length > 0
      ? `The page sees the new ${describeKinds(info.reload)} setting${info.reload.length > 1 ? 's' : ''} after a reload.`
      : 'Data cleared. Reload so the page lets go of what it still holds.'

  return (
    <div className="pn-view" key="home">
      <header className="pn-id">
        <SiteMark info={info} />
        <div className="pn-id-text">
          <b title={info.origin}>{info.host}</b>
          <span title={info.title}>{info.loading ? 'Loading...' : info.title || info.origin}</span>
        </div>
        <button type="button" className="pn-icon-btn" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div className="pn-conn-wrap">
        <button
          type="button"
          className={'pn-conn ' + (info.secure ? 'ok' : 'bad')}
          aria-expanded={certOpen}
          onClick={() => setCertOpen((o) => !o)}
        >
          <LockGlyph open={!info.secure} />
          <span>{info.secure ? 'Connection is secure' : 'Connection is not secure'}</span>
          {info.tabKind !== 'normal' && (
            <em className="pn-kind">
              {info.tabKind === 'tor' ? <TorIcon /> : <IncognitoIcon />}
              {info.tabKind === 'tor' ? 'Tor' : 'Private'}
            </em>
          )}
          <ChevronIcon />
        </button>
        {certOpen && (
          <div className="pn-cert">
            {!info.secure ? (
              <p>
                What you send and see here can be read or changed by others on the network. Do not
                enter passwords or card numbers.
              </p>
            ) : info.cert ? (
              <dl>
                <dt>Issued to</dt>
                <dd>{info.cert.subject}</dd>
                <dt>Issued by</dt>
                <dd>{info.cert.issuer}</dd>
                <dt>Valid</dt>
                <dd>
                  {day(info.cert.validFrom)} to {day(info.cert.validTo)}
                </dd>
              </dl>
            ) : (
              <p>
                Encrypted with a certificate Chromium trusts. Its details are read on the next new
                connection.
              </p>
            )}
            {info.tabKind !== 'normal' && (
              <p>
                {info.tabKind === 'tor' ? 'A Tor tab' : 'A private tab'}: what this site is allowed
                here, and what it stores, is forgotten when Panes closes.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="pn-body">
        {(info.reload.length > 0 || cleared) && (
          <div className="pn-banner" role="status">
            <ReloadIcon />
            <span>{reloadText}</span>
            <button type="button" className="pn-btn accent" onClick={reload}>
              Reload
            </button>
          </div>
        )}

        <Section title="Permissions" aside={<em>{summary}</em>}>
          {shown.map((p) => {
            const hint = permHint(p, info)
            return (
              <Row
                key={p.kind}
                icon={<PermIcon kind={p.kind} />}
                title={PERM_LABEL[p.kind]}
                hint={
                  hint && (
                    <>
                      {hint.tone === 'live' && <i className="pn-live" aria-hidden="true" />}
                      {hint.text}
                    </>
                  )
                }
                hintTone={hint?.tone}
              >
                <Segmented
                  label={PERM_LABEL[p.kind]}
                  value={p.kind === 'screen' && p.setting === 'allow' ? 'ask' : p.setting}
                  choices={p.kind === 'screen' ? SCREEN_CHOICES : CHOICES}
                  tone={(v) => (v === 'allow' ? 'good' : v === 'block' ? 'bad' : undefined)}
                  onChange={(v) => setPerm(p.kind, v)}
                />
              </Row>
            )
          })}
          {(hiddenCount > 0 || allPerms) && (
            <button
              type="button"
              className="pn-more"
              aria-expanded={allPerms}
              onClick={() => setAllPerms((a) => !a)}
            >
              {allPerms ? 'Show fewer' : `${hiddenCount} more`}
            </button>
          )}
        </Section>

        <Section title="Ads and trackers">
          <Row
            icon={<ShieldIcon />}
            title="Block ads and trackers"
            hint={
              !info.adblock.global
                ? 'Off for every site in Settings'
                : adblockOn
                  ? info.adblock.blocked > 0
                    ? `${info.adblock.blocked} blocked on this page`
                    : 'Nothing blocked on this page yet'
                  : 'Allowed on this site'
            }
          >
            <Switch
              label="Block ads and trackers on this site"
              on={adblockOn}
              disabled={!info.adblock.global}
              onChange={(v) =>
                send({ adblockOff: !v }, (i) => ({ ...i, adblock: { ...i.adblock, off: !v } }))
              }
            />
          </Row>
          {adblockOn && (
            <Row title="Hide ad spaces" hint="Turn off if the page looks broken">
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
            </Row>
          )}
        </Section>

        <Section title="This site">
          <Row title="Zoom">
            <span className="pn-zoom">
              <button
                type="button"
                aria-label="Zoom out"
                disabled={info.zoom <= ZOOM_LEVEL_MIN}
                onClick={() => zoomTo(info.zoom - 0.5)}
              >
                &minus;
              </button>
              <button
                type="button"
                className="val"
                aria-label={`Zoom ${zoomPct}%. Reset to the usual size`}
                disabled={info.zoom === info.defaultZoom}
                onClick={() => zoomTo(info.defaultZoom)}
              >
                {zoomPct}%
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                disabled={info.zoom >= ZOOM_LEVEL_MAX}
                onClick={() => zoomTo(info.zoom + 0.5)}
              >
                +
              </button>
            </span>
          </Row>
          <Row title="Mute" hint="In every tab of this site">
            <Switch
              label="Mute this site"
              on={info.muted}
              onChange={(v) => send({ muted: v }, (i) => ({ ...i, muted: v }))}
            />
          </Row>
          <Row title="Keep loaded" hint="Never put its tabs to sleep">
            <Switch
              label="Keep this site loaded"
              on={info.keepLoaded}
              onChange={(v) => send({ keepLoaded: v }, (i) => ({ ...i, keepLoaded: v }))}
            />
          </Row>
          <Row title="Dark page" hint={`For this site in ${info.spaceName || 'this space'}`}>
            <Switch
              label="Dark page"
              on={dark}
              onChange={(v) => {
                const boost = { ...(info.boost ?? DEFAULT_THEME), dark: v }
                send({ boost }, (i) => ({ ...i, boost }))
              }}
            />
          </Row>
          <button type="button" className="pn-link" onClick={onBoost}>
            <span>
              <b>Boost</b>
              <em>{info.boost ? 'On for this site' : 'Colour, font, hide parts of the page'}</em>
            </span>
            <ChevronIcon />
          </button>
        </Section>

        <Section title="Cookies and site data">
          {confirm === 'clear' ? (
            <Confirm
              text={`Clear cookies and stored data for ${info.host}? You may be signed out.`}
              action="Clear"
              onCancel={() => setConfirm(null)}
              onConfirm={() => {
                setConfirm(null)
                setCleared(true)
                send({ clearData: true }, (i) => ({ ...i, cookies: 0 }))
              }}
            />
          ) : (
            <Row
              title={
                info.cookies === 0
                  ? 'No cookies'
                  : `${info.cookies} cookie${info.cookies === 1 ? '' : 's'}`
              }
              hint="Plus storage, caches and service workers"
            >
              <button type="button" className="pn-btn" onClick={() => setConfirm('clear')}>
                Clear data
              </button>
            </Row>
          )}
        </Section>

        {confirm === 'reset' ? (
          <Confirm
            text={`Reset ${info.host}? Everything set here goes back to its default; cookies and site data stay.`}
            action="Reset"
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              setConfirm(null)
              send({ reset: true })
            }}
          />
        ) : (
          <button type="button" className="pn-reset" onClick={() => setConfirm('reset')}>
            Reset site settings
          </button>
        )}
      </div>
    </div>
  )
}
