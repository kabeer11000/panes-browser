import { useState } from 'react'
import type { Settings } from '@shared/types'
import type { ServerPolicy } from '@shared/share/servers'
import { Group, Row, Select } from '@renderer/internal/ui'

interface Props {
  s: Settings
  update: (patch: Partial<Settings>) => Promise<void>
}

const POLICIES: Array<{ value: ServerPolicy; label: string }> = [
  { value: 'ask', label: 'Ask the first time' },
  { value: 'any', label: 'Join without asking' },
  { value: 'listed', label: 'Only servers added here' }
]

/** A server address typed in, checked with the server itself before it is kept. */
function ServerField({
  placeholder,
  onAdd,
  button
}: {
  placeholder: string
  onAdd: (origin: string) => void
  button: string
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'checking' | 'bad'>('idle')
  const add = async (): Promise<void> => {
    setState('checking')
    const origin = await window.panesInternal.checkShareServer(text)
    if (!origin) return setState('bad')
    onAdd(origin)
    setText('')
    setState('idle')
  }
  return (
    <div className="u-row stacked">
      <div className="share-srv-add">
        <input
          className="int-input"
          value={text}
          placeholder={placeholder}
          spellCheck={false}
          aria-label={placeholder}
          onChange={(e) => {
            setText(e.target.value)
            setState('idle')
          }}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && void add()}
        />
        <button
          className="int-btn small"
          disabled={!text.trim() || state === 'checking'}
          onClick={() => void add()}
        >
          {state === 'checking' ? 'Checking...' : button}
        </button>
      </div>
      {state === 'bad' && (
        <p className="u-hint warn">
          No Panes share server answered there. Check the address (it starts with https://).
        </p>
      )}
    </div>
  )
}

/**
 * Shared spaces on other servers (shared/share/servers.ts): the server new spaces go to, the ones joined without
 * asking, what happens with others, and a TURN server of the person's own for live tabs.
 */
export function ShareServersSection({ s, update }: Props): React.JSX.Element {
  const [turn, setTurn] = useState(s.shareTurn ?? { url: '', username: '', credential: '' })
  const [turnBad, setTurnBad] = useState(false)
  const host = (o: string): string => new URL(o).host
  return (
    <Group
      title="Shared space servers"
      id="share-servers"
      footer="Spaces are encrypted with their link, so no server can read them, Panes' included. A server does see who connects and when. People who join in a web browser load the page from that server, so only trust servers you know."
    >
      <Row
        label="New shared spaces go to"
        hint="Panes' own server, or a community or self-hosted one (share/server in Panes' source runs anywhere)."
      >
        <Select
          label="New shared spaces go to"
          value={s.shareServer ?? ''}
          options={[
            { value: '', label: "Panes' server" },
            ...s.shareServersKnown.map((o) => ({ value: o, label: host(o) }))
          ]}
          onChange={(v) => void update({ shareServer: v || null })}
        />
      </Row>
      <Row
        label="Links to other servers"
        hint="When an invite is for a space on a server not listed below."
      >
        <Select
          label="Links to other servers"
          value={s.shareServerPolicy}
          options={POLICIES}
          onChange={(v) => void update({ shareServerPolicy: v })}
        />
      </Row>
      <Row
        label="Your servers"
        hint="Spaces on these join without asking, and new spaces can go to them."
        stacked
      >
        {s.shareServersKnown.length > 0 && (
          <ul className="share-srv-list">
            {s.shareServersKnown.map((o) => (
              <li key={o}>
                <span>{host(o)}</span>
                <button
                  className="int-btn small quiet"
                  onClick={() =>
                    void update({
                      shareServersKnown: s.shareServersKnown.filter((x) => x !== o),
                      ...(s.shareServer === o ? { shareServer: null } : {})
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Row>
      <ServerField
        placeholder="https://share.example.com"
        button="Add server"
        onAdd={(o) => void update({ shareServersKnown: [...new Set([...s.shareServersKnown, o])] })}
      />
      <Row
        label="Your own TURN server"
        hint="For live tabs when two computers cannot connect directly. Empty uses the space's server. Files never go through TURN."
        stacked
      >
        <div className="share-srv-turn">
          <input
            className="int-input"
            placeholder="turn:turn.example.com:3478"
            aria-label="TURN address"
            spellCheck={false}
            value={turn.url}
            onChange={(e) => {
              setTurn({ ...turn, url: e.target.value })
              setTurnBad(false)
            }}
          />
          <input
            className="int-input"
            placeholder="User name"
            aria-label="TURN user name"
            spellCheck={false}
            value={turn.username}
            onChange={(e) => setTurn({ ...turn, username: e.target.value })}
          />
          <input
            className="int-input"
            type="password"
            placeholder="Password"
            aria-label="TURN password"
            value={turn.credential}
            onChange={(e) => setTurn({ ...turn, credential: e.target.value })}
          />
          <button
            className="int-btn small"
            onClick={() => {
              if (!turn.url.trim()) {
                void update({ shareTurn: null })
                return
              }
              if (!/^turns?:/i.test(turn.url.trim())) return setTurnBad(true)
              void update({ shareTurn: { ...turn, url: turn.url.trim() } })
            }}
          >
            {turn.url.trim() ? 'Save' : 'Use the server'}
          </button>
        </div>
        {turnBad && <p className="u-hint warn">A TURN address starts with turn: or turns:</p>}
        {s.shareTurn && !turnBad && <p className="u-hint">Using {s.shareTurn.url}</p>}
      </Row>
    </Group>
  )
}
