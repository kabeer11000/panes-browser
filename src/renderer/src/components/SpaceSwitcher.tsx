import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useEffect, useId, useState } from 'react'
import type { Space } from '../../../shared/types'
import { PlusIcon } from './icons'
import { SpaceAvatar } from './SpaceAvatar'
import { holdOverlay, releaseOverlay } from '../overlay'
import { SpacePopover } from './SpacePopover'

interface Props {
  spaces: Space[]
  activeSpaceId: number
  /** Which way the editor opens: above (the sidebar's foot) or below (a top bar). */
  placement: 'up' | 'down'
  /** Show the active space's name beside the avatars. */
  caption?: boolean
  /** 1 or -1: the side the newly chosen space sits on, so names and lists slide the right way. */
  dir: number
  size?: number
}

/**
 * The row of space avatars: click to switch, click the current one (or right-click any) to edit it.
 * One component for the sidebar, the collapsed top bar and the horizontal tab bar, so spaces look and
 * behave the same wherever they appear.
 */
export function SpaceSwitcher({
  spaces,
  activeSpaceId,
  placement,
  caption = false,
  dir,
  size = 26
}: Props): React.JSX.Element {
  const [editingSpace, setEditingSpace] = useState<number | null>(null)
  const editing = spaces.find((s) => s.id === editingSpace)
  const groupId = useId() // the sliding ring is shared by one row only, never across switchers
  const owner = 'space-' + groupId

  // Page views are native and take every click over them, so while the editor is open the page is swapped
  // for its snapshot (as for the search popover). That also lets a click anywhere outside close the editor,
  // and keeps a dropped-down editor from hiding behind the page.
  const dropsOverPage = editing !== undefined
  useEffect(() => {
    if (!dropsOverPage) return
    void holdOverlay(owner)
    return () => void releaseOverlay(owner)
  }, [dropsOverPage, owner])

  return (
    <div className={'space-switcher ' + placement}>
      {editing && (
        <SpacePopover
          key={editing.id}
          space={editing}
          canDelete={spaces.length > 1}
          placement={placement}
          onClose={() => setEditingSpace(null)}
        />
      )}
      <LayoutGroup id={groupId}>
        <div className="space-row" role="tablist" aria-label="Spaces">
          {spaces.map((s, i) => {
            const on = s.id === activeSpaceId
            return (
              <motion.button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={on}
                aria-label={s.name}
                className={'space-chip no-drag' + (on ? ' active' : '')}
                data-space={s.id}
                title={`${s.name} (Ctrl+Alt+${i + 1}). ${on ? 'Click to edit' : 'Right-click to edit'}.`}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={() =>
                  on
                    ? setEditingSpace(editingSpace === s.id ? null : s.id)
                    : window.api.switchSpace(s.id)
                }
                onContextMenu={(e) => {
                  e.preventDefault()
                  setEditingSpace(s.id)
                }}
              >
                {on && (
                  <motion.span
                    layoutId="space-ring"
                    className="space-ring"
                    style={{ ['--sc' as string]: s.color }}
                    transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                  />
                )}
                <SpaceAvatar color={s.color} color2={s.color2} icon={s.icon} size={size} />
              </motion.button>
            )
          })}
          <button
            type="button"
            className="space-chip add no-drag"
            title="New space"
            aria-label="New space"
            onClick={window.api.createSpace}
          >
            <PlusIcon />
          </button>
          {caption && (
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={activeSpaceId}
                className="space-caption"
                initial={{ opacity: 0, x: 8 * dir }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 * dir }}
                transition={{ duration: 0.18 }}
              >
                {spaces.find((s) => s.id === activeSpaceId)?.name}
              </motion.span>
            </AnimatePresence>
          )}
        </div>
      </LayoutGroup>
    </div>
  )
}
