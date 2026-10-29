import { useEffect, useState } from 'react'
import {
  PERM_KINDS,
  PERM_LABEL,
  type PermSetting,
  type SiteGrant
} from '../../../../shared/permissions'
import { Group, Segmented, type Option } from '../ui'

const OPTIONS: Option<PermSetting>[] = [
  { value: 'ask', label: 'Ask' },
  { value: 'allow', label: 'Allow' },
  { value: 'block', label: 'Block' }
]

const host = (origin: string): string => origin.replace(/^https?:\/\//, '')
const time = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * Every site decision Panes remembers, so a mistaken Block or Allow is easy to undo. The same answers the site
 * panel and the prompts use: a change here applies to open tabs at once, and a change there shows up here
 * while this page is open. Private and Tor tabs' answers are not listed: they are never saved.
 */
export function SitePermissions(): React.JSX.Element {
  const [grants, setGrants] = useState<SiteGrant[] | null>(null)

  useEffect(() => {
    const load = (): void => void window.panesInternal.permissionsList().then(setGrants)
    load()
    return window.panesInternal.onPermissionsChanged(load)
  }, [])

  const set = (g: SiteGrant, setting: PermSetting): void =>
    void window.panesInternal.permissionSet(g.origin, g.kind, setting === 'ask' ? null : setting)
  const reset = (): void => void window.panesInternal.permissionsReset()

  const sorted = [...(grants ?? [])].sort(
    (a, b) =>
      host(a.origin).localeCompare(host(b.origin)) ||
      PERM_KINDS.indexOf(a.kind) - PERM_KINDS.indexOf(b.kind)
  )

  return (
    <Group
      title="Site permissions"
      footer="Sites ask before using your camera, microphone, location, notifications, clipboard, MIDI devices or window placement. Choosing Ask forgets the decision, so the site asks again."
    >
      {sorted.length === 0 && (
        <div className="u-row">
          <span className="u-label dim">
            {grants === null ? 'Loading...' : 'No saved decisions.'}
          </span>
        </div>
      )}
      {sorted.map((g) => (
        <div key={g.origin + g.kind} className="u-row">
          <div className="u-text">
            <div className="u-label">{host(g.origin)}</div>
            <div className="u-hint">
              {PERM_LABEL[g.kind]}
              {g.expires !== undefined && `, this time only (until ${time(g.expires)})`}
            </div>
          </div>
          <Segmented
            label={`${PERM_LABEL[g.kind]} for ${host(g.origin)}`}
            value={g.decision}
            options={OPTIONS}
            onChange={(v) => set(g, v)}
          />
        </div>
      ))}
      {sorted.length > 0 && (
        <div className="u-row center">
          <button className="int-btn danger" onClick={reset}>
            Reset all
          </button>
        </div>
      )}
    </Group>
  )
}
