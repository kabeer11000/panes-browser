import type { KeyboardEvent, WheelEvent } from 'react'
import type { Settings, TabInfo } from '../../../shared/types'
import { splitUrl } from '../../../shared/url'
import { CaptureBadge } from './CaptureBadge'
import { SiteIcon, SpeakerIcon, StarIcon } from './icons'
import { TabFavicon } from './TabFavicon'

interface Props {
  active: TabInfo | null
  /** Split view: this bar shows the focused pane, so it should say so. */
  paneFocus?: boolean
  /** Show the whole address or just the site name. */
  urlDisplay: Settings['urlDisplay']
  /** The bar is a doorway to the command bar, where all typing happens. */
  onOpen: () => void
  onWheel: (e: WheelEvent) => void
}

export function AddressBar({
  active,
  paneFocus = false,
  urlDisplay,
  onOpen,
  onWheel
}: Props): React.JSX.Element {
  const url = active?.url ?? ''
  const { host, rest } = splitUrl(url)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }

  return (
    <div
      className={'address no-drag' + (paneFocus ? ' pane-focus' : '')}
      role="button"
      tabIndex={0}
      aria-label="Search or enter address"
      title={paneFocus ? 'Address of the focused pane' : url || undefined}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
    >
      {/* Re-mounts when the focused pane changes, replaying a one-shot ring that links bar and pane. */}
      {paneFocus && <span key={active?.id} className="addr-pulse" />}
      {active && url && <TabFavicon tab={active} />}
      {url ? (
        <div className={'addr-display' + (urlDisplay === 'host' ? ' host-only' : '')}>
          <b>{host}</b>
          {urlDisplay === 'full' && <i>{rest}</i>}
        </div>
      ) : (
        <div className="addr-display placeholder">Search or enter address</div>
      )}
      {active && <CaptureBadge capture={active.capture} />}
      {active && (active.audible || active.muted) && (
        <button
          type="button"
          className={'addr-star' + (active.muted ? '' : ' on-audio')}
          title={active.muted ? 'Unmute tab' : 'Mute tab'}
          aria-label={active.muted ? 'Unmute tab' : 'Mute tab'}
          onClick={(e) => {
            e.stopPropagation()
            window.api.toggleMute(active.id)
          }}
        >
          <SpeakerIcon muted={active.muted} />
        </button>
      )}
      {active && /^https?:/i.test(url) && (
        <button
          type="button"
          className="addr-star addr-site"
          title="Site settings: boosts, ad blocking, permissions"
          aria-label="Site settings"
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            window.api.toggleSitePanel({ x: r.left, y: r.top, width: r.width, height: r.height })
          }}
        >
          <SiteIcon />
        </button>
      )}
      {active && /^https?:/i.test(url) && (
        <button
          type="button"
          className={'addr-star' + (active.bookmarked ? ' on' : '')}
          title={active.bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'}
          aria-label={active.bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          onClick={(e) => {
            e.stopPropagation()
            window.api.toggleBookmark()
          }}
        >
          <StarIcon filled={active.bookmarked} />
        </button>
      )}
      {active?.loading && <span className="load-bar" />}
    </div>
  )
}
