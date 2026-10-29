import { useState } from 'react'
import { attentionLabel, badgeText } from '../../../shared/attention'
import type { TabInfo } from '../../../shared/types'
import { GlobeIcon, IncognitoIcon, TorIcon } from './icons'

function Plain({ tab, noSpinner }: { tab: TabInfo; noSpinner?: boolean }): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  if (tab.loading && !noSpinner) return <span className="favicon spinner" />
  if (!tab.favicon || failed === tab.favicon) {
    // a private tab with no icon of its own wears the private mark in its place, so it is plain at a glance
    return (
      <span className={'favicon' + (tab.private ? ' mark' : '')}>
        {tab.tor ? <TorIcon /> : tab.private ? <IncognitoIcon /> : <GlobeIcon />}
      </span>
    )
  }
  return <img className="favicon" src={tab.favicon} alt="" onError={() => setFailed(tab.favicon)} />
}

/**
 * A tab's icon, wherever it is shown (sidebar, top row, overview). Something new waiting in the tab is a small dot on
 * its top corner, with the site's unread count in it when the site shows one.
 */
export function TabFavicon(props: { tab: TabInfo; noSpinner?: boolean }): React.JSX.Element {
  const a = props.tab.attention
  if (!a.unseen && a.count === 0) return <KindIcon {...props} />
  const said = attentionLabel(a)
  return (
    <span className="fav-attn" title={said}>
      <KindIcon {...props} />
      <b role="img" aria-label={said} className={a.count > 0 ? 'count' : ''}>
        {badgeText(a.count)}
      </b>
    </span>
  )
}

/**
 * A private tab carries the incognito mark and a Tor tab Tor's onion: as its icon when the page has none, else as a
 * small badge on the page's.
 */
function KindIcon(props: { tab: TabInfo; noSpinner?: boolean }): React.JSX.Element {
  const { tab } = props
  if (!tab.private) return <Plain {...props} />
  const bare = !tab.favicon || tab.loading
  return (
    <span
      className={'fav-priv' + (tab.tor ? ' tor' : '')}
      title={tab.tor ? 'Tor tab' : 'Private tab'}
    >
      <Plain {...props} />
      {!bare && <i aria-hidden="true">{tab.tor ? <TorIcon /> : <IncognitoIcon />}</i>}
    </span>
  )
}
