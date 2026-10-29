import { computeFrames } from '../../../shared/layout'
import type { StackEntry } from '../../../shared/stack'
import type { TabInfo } from '../../../shared/types'
import { displayHost } from '../../../shared/url'
import { TabFavicon } from './TabFavicon'

const MINI_GAP = 1.4 // gap between tiles in a group card, in percent of the card

/** Stand-in for a tab with no snapshot yet (it has not been on screen): its icon and site name. */
function Placeholder({ tab, compact }: { tab: TabInfo; compact?: boolean }): React.JSX.Element {
  return (
    <div className="thumb-skeleton" aria-hidden="true">
      <TabFavicon tab={tab} />
      {!compact && <span>{displayHost(tab.url) || 'New tab'}</span>}
    </div>
  )
}

/** Snapshot for a single tab, or a tiled group drawn as its layout with each tile's snapshot. */
export function CardThumb({
  entry,
  thumbs
}: {
  entry: StackEntry
  thumbs: Record<number, string>
}): React.JSX.Element {
  if (!entry.layout) {
    const tab = entry.tabs[0]
    const src = thumbs[tab.id]
    return src ? <img src={src} alt="" draggable={false} /> : <Placeholder tab={tab} />
  }
  const byId = new Map(entry.tabs.map((t) => [t.id, t]))
  const { leaves } = computeFrames(entry.layout, { x: 0, y: 0, w: 100, h: 100 }, MINI_GAP)
  return (
    <div className="mini-layout">
      {[...leaves].map(([id, f]) => {
        const tab = byId.get(id)
        return (
          <div
            key={id}
            className="mini-pane"
            style={{ left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, height: `${f.h}%` }}
          >
            {thumbs[id] ? (
              <img src={thumbs[id]} alt="" draggable={false} />
            ) : (
              tab && <Placeholder tab={tab} compact />
            )}
          </div>
        )
      })}
    </div>
  )
}
