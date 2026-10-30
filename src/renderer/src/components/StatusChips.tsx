import type { TabsState } from '../../../shared/types'

/**
 * What the window has to say that no page is saying: a short message about something that just happened (a saved
 * session), and, while a Tor tab is open, how Tor is doing whenever it is not connected. They sit in the window's own
 * chrome, where a page view cannot cover them.
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
  if (!showTor && !notice) return null
  return (
    <div className="status-chips">
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
