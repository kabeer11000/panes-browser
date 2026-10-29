import { useState } from 'react'
import type { TabInfo } from '../../../shared/types'
import { GlobeIcon } from './icons'

function Plain({ tab, noSpinner }: { tab: TabInfo; noSpinner?: boolean }): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  if (tab.loading && !noSpinner) return <span className="favicon spinner" />
  if (!tab.favicon || failed === tab.favicon) {
    return (
      <span className="favicon">
        <GlobeIcon />
      </span>
    )
  }
  return <img className="favicon" src={tab.favicon} alt="" onError={() => setFailed(tab.favicon)} />
}

/** A tab's icon, with a small violet dot on private tabs wherever they are shown (sidebar, top row, overview). */
export function TabFavicon(props: { tab: TabInfo; noSpinner?: boolean }): React.JSX.Element {
  if (!props.tab.private) return <Plain {...props} />
  return (
    <span className="fav-priv" title="Private tab">
      <Plain {...props} />
      <i aria-hidden="true" />
    </span>
  )
}
