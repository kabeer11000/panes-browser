import { useState } from 'react'
import type { Space, ShareState } from '@shared/types'
import { parseInvite } from '@shared/share/crypto'
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

/** The name the others see on this person's cursor and face; saved as it is left. */
function NameField({ name }: { name: string }): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const save = (): void => {
    if (draft !== null && draft.trim() && draft.trim() !== name) window.api.share?.setName(draft)
    setDraft(null)
  }
  return (
    <label className="share-name">
      <span className="share-or">You appear as</span>
      <input
        className="share-join-input"
        value={draft ?? name}
        maxLength={40}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  )
}

const isInvite = (text: string): boolean =>
  /^panes:\/\/join\/[A-Za-z0-9_-]{16,64}#[A-Za-z0-9_-]{43}$/.test(text) || !!parseInvite(text)

/** Someone sent an invite link: paste it here (or in the address bar) and the space is joined and shown. */
function JoinWithLink(): React.JSX.Element {
  const [link, setLink] = useState('')
  const text = link.trim()
  const bad = text !== '' && !isInvite(text)
  const join = (): void => {
    if (!text || bad) return
    window.api.navigate(text) // main joins it, as an invite opened any other way, and goes to it
    setLink('')
  }
  return (
    <div className="share-join">
      <span className="share-or">Have an invite link?</span>
      <div className="share-join-row">
        <input
          className="share-join-input"
          placeholder="Paste it here"
          value={link}
          spellCheck={false}
          aria-invalid={bad}
          aria-label="Invite link"
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && join()}
        />
        <button type="button" className="share-btn" disabled={!text || bad} onClick={join}>
          Join
        </button>
      </div>
      {bad && <p className="share-note warn">That is not a Panes invite link.</p>}
    </div>
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
        <JoinWithLink />
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
      {state && <NameField name={state.me.name} />}
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
