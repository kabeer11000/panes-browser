import { useEffect, useRef, useState } from 'react'
import type { Space } from '../../../shared/types'
import { SpaceIdentity } from './SpaceIdentity'
import { ThemePicker } from './ThemePicker'

interface Props {
  space: Space
  canDelete: boolean
  placement?: 'up' | 'down'
  onClose: () => void
}

/** Edit a space from the sidebar: who it is, how it looks, and removal. Closes on Escape or an outside click. */
export function SpacePopover({
  space,
  canDelete,
  placement = 'up',
  onClose
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState(false)

  // The window's drag regions swallow clicks, so while this is open they stop dragging and a click on
  // the top bar reaches the outside-click handler below like a click anywhere else.
  useEffect(() => {
    document.documentElement.classList.add('popover-open')
    return () => document.documentElement.classList.remove('popover-open')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: globalThis.PointerEvent): void => {
      const t = e.target as HTMLElement
      // Chips open this popover, so a press on one must not also close it.
      if (!ref.current?.contains(t) && !t.closest('.space-chip')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [onClose])

  return (
    <div
      className={'space-popover ' + placement}
      ref={ref}
      role="dialog"
      aria-label={`Edit ${space.name}`}
    >
      {/* the card keeps its shadow; only this inner part scrolls, so its edges can fade */}
      <div className="space-pop-scroll">
        <SpaceIdentity
          space={space}
          onName={(name) => window.api.updateSpace(space.id, { name })}
          onIcon={(icon) => window.api.updateSpace(space.id, { icon })}
        />
        <div className="sp-divider" />
        <ThemePicker
          color={space.color}
          color2={space.color2}
          tint={space.tint}
          grain={space.grain}
          mode={space.mode}
          onChange={(patch) => window.api.updateSpace(space.id, patch)}
        />
        <div className="space-actions">
          <button
            type="button"
            className="tp-toggle"
            onClick={() => {
              window.api.openInternal('settings')
              onClose()
            }}
          >
            More settings for this space
          </button>
          {canDelete &&
            (confirming ? (
              <button
                type="button"
                className="tp-toggle danger"
                onClick={() => window.api.deleteSpace(space.id)}
              >
                Close its tabs and delete
              </button>
            ) : (
              <button
                type="button"
                className="tp-toggle danger"
                onClick={() => setConfirming(true)}
              >
                Delete space
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
