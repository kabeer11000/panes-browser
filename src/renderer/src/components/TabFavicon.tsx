import { useState } from 'react'
import type { TabInfo } from '../../../shared/types'
import { GlobeIcon } from './icons'

export function TabFavicon({ tab }: { tab: TabInfo }): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  if (tab.loading) return <span className="favicon spinner" />
  if (!tab.favicon || failed === tab.favicon) {
    return (
      <span className="favicon">
        <GlobeIcon />
      </span>
    )
  }
  return <img className="favicon" src={tab.favicon} alt="" onError={() => setFailed(tab.favicon)} />
}
