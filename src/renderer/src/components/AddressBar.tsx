import { useEffect, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react'
import type { TabInfo } from '../../../shared/types'
import { displayHost } from '../../../shared/url'
import { StarIcon } from './icons'
import { TabFavicon } from './TabFavicon'

interface Props {
  active: TabInfo | null
  focusTick: number
  /** Only the visible instance reacts to focus requests (the sidebar one is hidden when collapsed). */
  visible: boolean
  /** Split view: this bar edits whichever pane is focused, so it should say so. */
  paneFocus?: boolean
  onWheel: (e: WheelEvent) => void
}

export function AddressBar({
  active,
  focusTick,
  visible,
  paneFocus = false,
  onWheel
}: Props): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const seenTick = useRef(focusTick)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const url = active?.url ?? ''

  useEffect(() => {
    if (focusTick === seenTick.current) return
    seenTick.current = focusTick
    if (visible) inputRef.current?.focus()
  }, [focusTick, visible])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      window.api.navigate(draft)
      inputRef.current?.blur()
    } else if (e.key === 'Escape') {
      inputRef.current?.blur()
    }
  }

  return (
    <div
      className={'address no-drag' + (editing ? ' editing' : '') + (paneFocus ? ' pane-focus' : '')}
      title={paneFocus ? 'Address of the focused pane' : undefined}
      onWheel={onWheel}
    >
      {/* Re-mounts when the focused pane changes, replaying a one-shot ring that links bar and pane. */}
      {paneFocus && <span key={active?.id} className="addr-pulse" />}
      {active && url && !editing && <TabFavicon tab={active} />}
      <input
        ref={inputRef}
        value={editing ? draft : displayHost(url)}
        placeholder="Search or enter address"
        spellCheck={false}
        tabIndex={visible ? 0 : -1}
        onFocus={() => {
          setDraft(url)
          setEditing(true)
          requestAnimationFrame(() => inputRef.current?.select())
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {active && /^https?:/i.test(url) && (
        <button
          className={'addr-star' + (active.bookmarked ? ' on' : '')}
          title={active.bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={window.api.toggleBookmark}
        >
          <StarIcon filled={active.bookmarked} />
        </button>
      )}
      {active?.loading && <span className="load-bar" />}
    </div>
  )
}
