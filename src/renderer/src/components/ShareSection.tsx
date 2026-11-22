import { useState } from 'react'
import type { Space, ShareState } from '@shared/types'
import { useShareState } from './useShare'

const STATUS: Record<ShareState['status'], string> = {
  connecting: 'Connecting',
  syncing: 'Catching up',
  live: 'Live',
  offline: 'Offline: changes wait and go out when you are back',
  refused: 'The room did not let this link in'
}

/** Someone's initials on their colour, as on their cursor. */
export function Face({ name, color, size = 22 }: { name: string; color: string; size?: number }): React.JSX.Element {
  const initials =
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  return (
    <span
      className="share-face"
      style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}
      title={name}
      aria-label={name}
    >
      {initials}
    </span>
  )
}

/**
 * Sharing a space, in its editor: invite people (the link is copied), see who is here and how the connection is,
 * copy the link again, or stop. Everything in the room is end-to-end encrypted with the link's secret.
 */
export function ShareSection({ space }: { space: Space }): React.JSX.Element | null {
  const shared = !!space.shared
  const state = useShareState(space.id, shared)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!window.api.share) return null

  const copy = async (link: string | null): Promise<void> => {
    if (!link) return setFailed(true)
    await navigator.clipboard.writeText(link)
    setFailed(false)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2200)
  }

  if (!shared)
    return (
      <div className="share-sec">
        <span className="tp-title">Share</span>
        <p className="share-note">
          Work on this board together, live. Anyone with the link can join, in Panes or in their browser.
          Everything is end-to-end encrypted.
        </p>
        <button
          type="button"
          className="share-btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await copy(await window.api.share!.start(space.id))
            setBusy(false)
          }}
        >
          {busy ? 'Making a room...' : 'Invite people'}
        </button>
        {failed && <p className="share-note warn">The space could not be shared. Try again in a moment.</p>}
      </div>
    )

  const people = state?.people ?? []
  const status = state?.status ?? 'connecting'
  return (
    <div className="share-sec">
      <div className="share-head">
        <span className="tp-title">Shared</span>
        <span className={'share-status ' + status}>
          <i aria-hidden="true" />
          {STATUS[status]}
        </span>
      </div>
      <div className="share-people">
        {state && <Face name={`${state.me.name} (you)`} color={state.me.color} />}
        {people.map((p) => (
          <Face key={p.id} name={p.name} color={p.color} />
        ))}
        <span className="share-count">
          {people.length === 0 ? 'Only you, so far' : `${people.length + 1} here`}
        </span>
      </div>
      <div className="share-actions">
        <button
          type="button"
          className="share-btn"
          onClick={async () => copy(await window.api.share!.link(space.id))}
        >
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
        {stopping ? (
          <button
            type="button"
            className="share-btn danger"
            onClick={() => {
              window.api.share!.stop(space.id)
              setStopping(false)
            }}
          >
            Stop: keep my copy
          </button>
        ) : (
          <button type="button" className="share-btn quiet" onClick={() => setStopping(true)}>
            Stop sharing
          </button>
        )}
      </div>
    </div>
  )
}
