import { useEffect, useState } from 'react'
import type { TorStatus } from '../../../../shared/tor'
import { Group, Row, Toggle } from '../ui'

const blank: TorStatus = {
  state: 'off',
  progress: 0,
  message: '',
  snowflake: false,
  usage: { up: 0, down: 0 },
  supported: true
}

const LABEL: Record<TorStatus['state'], string> = {
  off: 'Not running',
  downloading: 'Getting Tor',
  starting: 'Connecting',
  ready: 'Connected',
  error: 'Could not connect'
}

/** Tor for private tabs: connect, see how far along it is, open a Tor tab, and use Snowflake where Tor is blocked. */
export function TorSection({
  snowflake,
  onSnowflake
}: {
  snowflake: boolean
  onSnowflake: (v: boolean) => void
}): React.JSX.Element {
  const api = window.panesInternal
  const [st, setSt] = useState<TorStatus>(blank)

  useEffect(() => {
    const load = (): void => void api.torStatus().then(setSt)
    load()
    const t = setInterval(load, 700)
    return () => clearInterval(t)
  }, [api])

  const busy = st.state === 'downloading' || st.state === 'starting'
  return (
    <Group
      title="Tor"
      footer="A Tor tab is private and sends its traffic through the Tor network, which hides your address from the sites you visit. It is not Tor Browser: Panes looks different from other Tor users, so sites can still tell your browser apart. Tor is downloaded from the Tor Project the first time you connect, about 25 MB."
    >
      {!st.supported ? (
        <Row label="Tor is not available on this system yet" />
      ) : (
        <>
          <Row
            label={LABEL[st.state]}
            hint={
              st.state === 'error'
                ? st.message
                : busy
                  ? `${st.message}${st.state === 'downloading' ? `, ${st.progress}%` : ''}`
                  : st.state === 'ready'
                    ? 'Tor tabs go through the Tor network'
                    : 'Starts when you open a Tor tab, or here'
            }
          >
            <span className="u-actions">
              {st.state === 'ready' || busy ? (
                <button className="int-btn small" onClick={() => void api.torStop()}>
                  Disconnect
                </button>
              ) : (
                <button className="int-btn small" onClick={() => void api.torStart(snowflake)}>
                  Connect
                </button>
              )}
              <button
                className="int-btn small"
                disabled={st.state !== 'ready'}
                onClick={() => void api.torNewTab()}
              >
                New Tor tab
              </button>
            </span>
          </Row>
          {busy && (
            <div className="u-progress" role="progressbar" aria-valuenow={st.progress}>
              <span style={{ width: `${st.progress}%` }} />
            </div>
          )}
          <Row
            label="Use Snowflake"
            hint="For networks that block Tor. Slower, but looks like an ordinary video call. Applies the next time you connect."
          >
            <Toggle label="Use Snowflake" on={snowflake} onChange={onSnowflake} />
          </Row>
        </>
      )}
    </Group>
  )
}
