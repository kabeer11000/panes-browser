import { useEffect, useState } from 'react'
import { PERM_LABEL, type PermKind, type SiteGrant } from '../../../../shared/permissions'
import { Group } from '../ui'

/** Every site decision Panes remembers, so a mistaken Block or Allow is easy to undo. */
export function SitePermissions(): React.JSX.Element {
  const [grants, setGrants] = useState<SiteGrant[] | null>(null)

  useEffect(() => {
    void window.panesInternal.permissionsList().then(setGrants)
  }, [])

  const remove = async (origin: string, kind: PermKind): Promise<void> => {
    await window.panesInternal.permissionRemove(origin, kind)
    setGrants(await window.panesInternal.permissionsList())
  }
  const reset = async (): Promise<void> => {
    await window.panesInternal.permissionsReset()
    setGrants([])
  }

  const sorted = [...(grants ?? [])].sort(
    (a, b) => a.origin.localeCompare(b.origin) || a.kind.localeCompare(b.kind)
  )

  return (
    <Group
      title="Site permissions"
      footer="Sites ask before using your camera, microphone, location, notifications or clipboard. Removing a decision makes the site ask again."
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
          <span className="u-label">
            {g.origin.replace(/^https?:\/\//, '')}
            <span className="u-hint">
              {PERM_LABEL[g.kind]}: {g.decision === 'allow' ? 'Allowed' : 'Blocked'}
            </span>
          </span>
          <button
            className="int-btn small"
            aria-label={`Remove ${PERM_LABEL[g.kind]} decision for ${g.origin}`}
            onClick={() => void remove(g.origin, g.kind)}
          >
            Remove
          </button>
        </div>
      ))}
      {sorted.length > 0 && (
        <div className="u-row center">
          <button className="int-btn danger" onClick={() => void reset()}>
            Reset all
          </button>
        </div>
      )}
    </Group>
  )
}
