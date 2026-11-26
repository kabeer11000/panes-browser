import { useEffect, useState } from 'react'
import { Board } from './Board'
import { Chat } from './Chat'
import { loadMe, useRoom } from './room'
import { Watch } from './Watch'
import { GET_PANES, room, secret } from './link'
import { joinLink } from '@shared/share/servers'

/**
 * A shared space from the web (tasks/shared-spaces.md, phase 6): the invite link's page. People with Panes open it
 * there; everyone else gets the board itself, live: everyone's pointers, notes they can add, and anyone's live tab to
 * watch. It is clearly the lesser version: "Open in Panes" and "Get Panes" stay in sight.
 *
 * The room is in the address and its secret after # (never sent to the server): the board is opened here, with it.
 */

function Mark(): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="5" rx="2" />
      <rect x="13" y="10" width="8" height="11" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
    </svg>
  )
}

const STATUS: Record<string, string> = {
  connecting: 'Connecting…',
  syncing: 'Catching up…',
  live: 'Connected',
  offline: 'Reconnecting…',
  refused: 'Link refused'
}

export function BadLink({ refused }: { refused?: boolean }): React.JSX.Element {
  return (
    <main className="wb-card-page">
      <div className="wb-mark">
        <Mark />
      </div>
      <h1>{refused ? 'This invite no longer works' : 'This link is not complete'}</h1>
      <p>
        {refused
          ? 'The space may have stopped being shared. Ask for a new invite.'
          : 'Part of the invite is missing. Ask for the link again, and copy all of it.'}
      </p>
      <a className="wb-get" href={GET_PANES} rel="noopener">
        Get Panes for Windows or Mac
      </a>
    </main>
  )
}

/** Someone's initials on their colour, as on their cursor (Panes' Face). */
function Face({
  name,
  color,
  size = 22
}: {
  name: string
  color: string
  size?: number
}): React.JSX.Element {
  const initials =
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  return (
    <span
      className="wb-face"
      style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}
      title={name}
    >
      {initials}
    </span>
  )
}

export function App(): React.JSX.Element {
  const [me, setMeState] = useState(loadMe)
  const r = useRoom(room, secret, me)
  const [watching, setWatching] = useState<number | null>(null)
  /** Calls to the watched tab made afresh (Try again): a new key, a new call. */
  const [tries, setTries] = useState(0)
  const [peopleOpen, setPeopleOpen] = useState(false)
  // Open in Panes names this server, so a space on a community or self-hosted one opens there
  const join = joinLink(location.origin, room, secret)

  // once, as the page opens: the browser offers to open Panes (nothing happens without it)
  useEffect(() => {
    try {
      if (sessionStorage.getItem('tried-' + room)) return
      sessionStorage.setItem('tried-' + room, '1')
    } catch {
      return
    }
    const t = setTimeout(() => (location.href = join), 400)
    return () => clearTimeout(t)
  }, [join])
  useEffect(() => {
    document.title = `${r.meta.name} · Panes`
  }, [r.meta.name])
  // the space's own colour, as Panes tints its board with it
  useEffect(() => {
    if (/^#[0-9a-f]{6}$/i.test(r.meta.color))
      document.documentElement.style.setProperty('--space', r.meta.color)
  }, [r.meta.color])

  if (r.status === 'refused') return <BadLink refused />
  const showing = r.people.filter((p) => p.live && p.rtc)
  const watched = showing.find((p) => p.id === watching) ?? null
  const setMe = (m: { name: string; color: string }): void => {
    setMeState(m)
    r.setMe(m)
  }
  const here = r.people.length + 1

  return (
    <>
      <Board
        state={r.state}
        people={r.people}
        onEdit={r.edit}
        onPoint={r.point}
        fileOf={r.fileOf}
      />
      <header className="wb-top">
        <span className="wb-logo" aria-hidden="true">
          <Mark />
        </span>
        <span className="wb-space-name">{r.meta.name}</span>
      </header>
      <div className="wb-right">
        <div className="wb-share-at">
          <button
            type="button"
            className={'wb-share ' + r.status}
            aria-expanded={peopleOpen}
            title={STATUS[r.status]}
            onClick={() => setPeopleOpen(!peopleOpen)}
          >
            <span className="wb-share-dot" aria-hidden="true" />
            <span className="wb-share-faces" aria-hidden="true">
              {r.people.slice(0, 3).map((p) => (
                <Face key={p.id} name={p.name} color={p.color} size={18} />
              ))}
            </span>
            {r.status === 'live' ? (here === 1 ? 'Just you' : `${here} here`) : STATUS[r.status]}
          </button>
          {peopleOpen && (
            <div className="wb-pop" role="dialog" aria-label="People here">
              <div className="wb-pop-row">
                <Face name={me.name} color={me.color} size={26} />
                <input
                  value={me.name}
                  maxLength={40}
                  aria-label="Your name"
                  title="Your name, as the others see it"
                  onChange={(e) => setMe({ ...me, name: e.target.value })}
                  onBlur={(e) => !e.target.value.trim() && setMe({ ...me, name: 'Guest' })}
                />
                <span className="wb-pop-you">you</span>
              </div>
              {r.people.map((p) => (
                <div key={p.id} className="wb-pop-row">
                  <Face name={p.name} color={p.color} size={26} />
                  <span className="wb-pop-name">{p.name}</span>
                  {p.live && <span className="wb-pop-live">Live</span>}
                </div>
              ))}
              <p className="wb-pop-note">
                Everything here is end-to-end encrypted. Sections, drawing and live tabs are made in{' '}
                <a href={GET_PANES} rel="noopener">
                  Panes
                </a>
                .
              </p>
            </div>
          )}
        </div>
        <Chat messages={r.chat} me={r.meId} onSay={r.say} join={join} />
        <a className="wb-open" href={join}>
          Open in Panes
        </a>
      </div>
      {showing.length > 0 && !watched && (
        <div className="wb-lives">
          {showing.map((p) => (
            <button key={p.id} type="button" className="wb-live" onClick={() => setWatching(p.id)}>
              <span className="wb-live-dot" aria-hidden="true" />
              <span className="wb-live-what">
                <b>{p.name.split(' ')[0]}</b> is presenting {p.live?.title || 'a tab'}
              </span>
              <em>Watch</em>
            </button>
          ))}
        </div>
      )}
      {watched && (
        <Watch
          key={`${watched.id}:${tries}`}
          onRetry={() => setTries((n) => n + 1)}
          room={r}
          host={watched}
          people={r.people}
          myName={me.name}
          onClose={() => setWatching(null)}
        />
      )}
    </>
  )
}
