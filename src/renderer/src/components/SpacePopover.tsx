import { useEffect, useRef, useState } from 'react'
import type { Space } from '../../../shared/types'
import { ThemePicker } from './ThemePicker'

interface Props {
  space: Space
  canDelete: boolean
  onClose: () => void
}

/** Edit a space from the sidebar: name, theme and removal. Closes on Escape or an outside click. */
export function SpacePopover({ space, canDelete, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [name, setName] = useState(space.name)
  const [confirming, setConfirming] = useState(false)

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

  const commitName = (): void => {
    const next = name.trim()
    if (next && next !== space.name) window.api.updateSpace(space.id, { name: next })
    else setName(space.name)
  }

  return (
    <div className="space-popover" ref={ref} role="dialog" aria-label={`Edit ${space.name}`}>
      <input
        className="space-name"
        value={name}
        maxLength={24}
        aria-label="Space name"
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
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
          Interface size for this space
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
            <button type="button" className="tp-toggle danger" onClick={() => setConfirming(true)}>
              Delete space
            </button>
          ))}
      </div>
    </div>
  )
}
