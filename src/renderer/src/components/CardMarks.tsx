import type { StackEntry } from '../../../shared/stack'
import { SplitIcon } from './icons'
import { TabFavicon } from './TabFavicon'

const MAX_ICONS = 4

/** The site icon of a tab, or those of every tile of a split side by side, so a split reads as one at a glance. */
export function CardFavicons({ entry }: { entry: StackEntry }): React.JSX.Element {
  const shown = entry.tabs.slice(0, MAX_ICONS)
  return (
    <span className="card-favicons">
      {shown.map((t) => (
        <TabFavicon key={t.id} tab={t} />
      ))}
      {entry.tabs.length > shown.length && <span>+{entry.tabs.length - shown.length}</span>}
    </span>
  )
}

/** What a card says about its tabs beyond the title: how many tiles a split has, and that it holds the tab on screen. */
export function CardMarks({
  entry,
  current
}: {
  entry: StackEntry
  current: boolean
}): React.JSX.Element {
  return (
    <>
      {entry.tabs.length > 1 && (
        <span className="card-split" title={`Split of ${entry.tabs.length} tabs`}>
          <SplitIcon />
          {entry.tabs.length}
        </span>
      )}
      {current && (
        <span className="card-current" title="Current tab" role="img" aria-label="Current tab" />
      )}
    </>
  )
}
