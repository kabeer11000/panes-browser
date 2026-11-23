import { useEffect, useState } from 'react'
import { Board } from './Board'
import { Chat } from './Chat'
import { loadMe, useRoom } from './room'
import { Watch } from './Watch'
import { GET_PANES, room, secret } from './link'

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

export function App(): React.JSX.Element {
  const [me, setMeState] = useState(loadMe)
  const r = useRoom(room, secret, me)
  const [watching, setWatching] = useState<number | null>(null)
  const [hint, setHint] = useState(true)
  const join = `panes://join/${room}#${secret}`

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
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 7000)
    return () => clearTimeout(t)
  }, [])

  if (r.status === 'refused') return <BadLink refused />
  const showing = r.people.filter((p) => p.live && p.rtc)
  const watched = showing.find((p) => p.id === watching) ?? null
  const setMe = (m: { name: string; color: string }): void => {
    setMeState(m)
    r.setMe(m)
  }

  return (
    <>
      <Board state={r.state} people={r.people} onEdit={r.edit} onPoint={r.point} />
      <header className="wb-top">
        <div className="wb-space">
          <span className="wb-logo">
            <Mark />
          </span>
          <b>{r.meta.name}</b>
          {r.status !== 'live' && (
            <span className="wb-status">
              {r.status === 'offline' ? 'Reconnecting…' : 'Connecting…'}
            </span>
          )}
        </div>
        <div className="wb-people" aria-label="People here">
          {r.people.slice(0, 6).map((p) => (
            <span key={p.id} className="wb-face" style={{ background: p.color }} title={p.name}>
              {p.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
          <label className="wb-me" title="Your name, as the others see it">
            <span className="wb-face" style={{ background: me.color }}>
              {me.name.slice(0, 1).toUpperCase()}
            </span>
            <input
              value={me.name}
              maxLength={40}
              aria-label="Your name"
              onChange={(e) => setMe({ ...me, name: e.target.value })}
              onBlur={(e) => !e.target.value.trim() && setMe({ ...me, name: 'Guest' })}
            />
          </label>
        </div>
        <Chat messages={r.chat} me={r.meId} onSay={r.say} />
        <div className="wb-actions">
          <a className="wb-btn quiet" href={GET_PANES} rel="noopener">
            Get Panes
          </a>
          <a className="wb-btn primary" href={join}>
            Open in Panes
          </a>
        </div>
      </header>
      {showing.length > 0 && !watched && (
        <div className="wb-lives">
          {showing.map((p) => (
            <button key={p.id} type="button" className="wb-live" onClick={() => setWatching(p.id)}>
              <span className="wb-dot" aria-hidden="true" />
              <span>
                <b>{p.name}</b> is showing {p.live?.title || 'a tab'}
              </span>
              <em>Watch</em>
            </button>
          ))}
        </div>
      )}
      {watched && (
        <Watch
          key={watched.id}
          room={r}
          host={watched}
          people={r.people}
          myName={me.name}
          onClose={() => setWatching(null)}
        />
      )}
      <footer className={'wb-hint' + (hint ? '' : ' gone')} aria-hidden={!hint}>
        Double-click the board for a note &middot; drag to move around &middot; Ctrl+scroll to zoom.
        Sections, drawing and live pages are made in Panes.
      </footer>
    </>
  )
}
