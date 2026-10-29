import { useState, type KeyboardEvent, type WheelEvent } from 'react'
import type { Settings, TabInfo } from '../../../shared/types'
import { splitUrl } from '../../../shared/url'
import { SiteIcon, SpeakerIcon, StarIcon } from './icons'
import { SiteSettings } from './SiteSettings'
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
  // Where the site settings button is while its panel is open (the panel hangs under it); null when closed.
  const [siteAnchor, setSiteAnchor] = useState<DOMRect | null>(null)
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
          className={'addr-star addr-site' + (siteAnchor ? ' open' : '')}
          title="Site settings: boosts, ad blocking, permissions"
          aria-label="Site settings"
          aria-expanded={siteAnchor !== null}
          onClick={(e) => {
            e.stopPropagation()
            const rect = e.currentTarget.getBoundingClientRect()
            setSiteAnchor((open) => (open ? null : rect))
          }}
        >
          <SiteIcon />
        </button>
      )}
      {siteAnchor && <SiteSettings anchor={siteAnchor} onClose={() => setSiteAnchor(null)} />}
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
