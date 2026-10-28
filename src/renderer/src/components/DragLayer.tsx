import { ROOT_TARGET } from '../../../shared/layout'
import type { TabInfo } from '../../../shared/types'
import type { DragState } from '../hooks/useTabDrag'
import { tabTitle } from '../tabTitle'
import { TabFavicon } from './TabFavicon'

const LABELS = {
  left: 'Split left',
  right: 'Split right',
  top: 'Split above',
  bottom: 'Split below',
  center: 'Swap here'
} as const

const ROOT_LABELS = {
  left: 'Dock on the left',
  right: 'Dock on the right',
  top: 'Dock along the top',
  bottom: 'Dock along the bottom',
  center: ''
} as const

/** The chip that follows the pointer while dragging a tab. */
export function DragLayer({
  drag,
  tab
}: {
  drag: DragState
  tab?: TabInfo
}): React.JSX.Element | null {
  if (!tab) return null
  return (
    <div
      className="drag-ghost"
      style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 10}px)` }}
    >
      <TabFavicon tab={tab} />
      <span className="tab-title">{tabTitle(tab)}</span>
      {drag.count > 1 && <span className="ghost-count">+{drag.count - 1}</span>}
    </div>
  )
}

/** Highlights where a drop would tile; glides between panes and edges as the pointer moves. */
export function DropIndicator({ drag }: { drag: DragState }): React.JSX.Element | null {
  const stage = document.querySelector('.stage')?.getBoundingClientRect()
  if (!stage || !drag.box) return null
  const active = drag.target?.kind === 'pane'
  const edge = drag.target?.kind === 'pane' ? drag.target.edge : 'center'
  return (
    <div
      className={'drop-indicator' + (active ? ' active' : '')}
      style={{
        left: drag.box.x - stage.left,
        top: drag.box.y - stage.top,
        width: drag.box.w,
        height: drag.box.h
      }}
    >
      <span>
        {drag.target?.kind === 'pane' && drag.target.tabId === ROOT_TARGET
          ? ROOT_LABELS[edge]
          : LABELS[edge]}
      </span>
    </div>
  )
}
