import type { TabsState } from '@shared/types'
import { useHostViews } from '@renderer/liveHost'

/**
 * What the window has to say that no page is saying: a short message about something that just happened (a saved
 * session), while a Tor tab is open how Tor is doing whenever it is not connected, and a tab shown live in a shared
 * space (who watches, who asks to drive or drives, with the host's answers). They sit in the window's own chrome, where
 * a page view cannot cover them.
 */
export function StatusChips({
  tor,
  notice
}: {
  tor: TabsState['tor']
  notice: TabsState['notice']
}): React.JSX.Element | null {
  const working = tor.state === 'downloading' || tor.state === 'starting'
  const showTor = tor.tabs > 0 && tor.state !== 'ready'
  const live = useHostViews()
  if (!showTor && !notice && live.length === 0) return null
  return (
    <div className="status-chips">
      {live.map((v) => (
        <div key={`live${v.spaceId}`} className="status-chip live" role="status">
          <span className="status-dot live" aria-hidden="true" />
          {v.asking ? (
            <>
              <span>{v.asking.name} asks to drive</span>
              <button type="button" className="primary" onClick={v.allow}>
                Let them
              </button>
              <button type="button" onClick={v.deny}>
                No
              </button>
            </>
          ) : v.driver ? (
            <>
              <span>{v.driver.name} is driving</span>
              <button type="button" onClick={v.takeBack}>
                Take back
              </button>
            </>
          ) : (
            <>
              <span>Live{v.watching > 0 ? ` · ${v.watching} watching` : ''}</span>
              <button type="button" onClick={v.stop}>
                Stop
              </button>
            </>
          )}
        </div>
      ))}
      {notice && (
        <div key={notice.id} className="status-chip" role="status">
          {notice.text}
        </div>
      )}
      {showTor && (
        <div className={'status-chip tor' + (working ? '' : ' down')} role="status">
          <span className={'status-dot' + (working ? ' busy' : '')} />
          <span>
            {working
              ? `Connecting to Tor${tor.progress > 0 ? ` ${Math.round(tor.progress)}%` : ''}`
              : tor.state === 'error'
                ? 'Tor disconnected'
                : 'Tor is off'}
          </span>
          {!working && (
            <button type="button" onClick={() => window.api.torReconnect()}>
              Reconnect
            </button>
          )}
        </div>
      )}
    </div>
  )
}
