import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useEffect, useId, useState } from 'react'
import type { Space } from '../../../shared/types'
import { attentionLabel, badgeText } from '../../../shared/attention'
import { useSpaceMarks } from '../hooks/useSpaceAudio'
import { PlusIcon, SpeakerIcon } from './icons'
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
  const groupId = useId() // scopes the layout animation to this row, never across switchers
  const owner = 'space-' + groupId
  const { spaceAudio: audio, spaceAttention } = useSpaceMarks()

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
            const sound = audio[s.id]
            const sounding = !!sound && (sound.playing || sound.muted)
            // What waits in the other spaces; the one you are in shows it on its own tabs.
            const waiting = on ? undefined : spaceAttention[s.id]
            const said = waiting ? attentionLabel(waiting) : ''
            return (
              <motion.button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={on}
                aria-label={said ? `${s.name}: ${said}` : s.name}
                className={'space-chip no-drag' + (on ? ' active' : '')}
                layout
                data-space={s.id}
                title={`${s.name} (Ctrl+Alt+${i + 1}). ${said ? said + '. ' : ''}${on ? 'Click to edit' : 'Right-click to edit'}.`}
                onClick={() =>
                  on
                    ? setEditingSpace(editingSpace === s.id ? null : s.id)
                    : waiting?.callTabId != null
                      ? window.api.activateTab(waiting.callTabId) // straight to the call, in its space
                      : window.api.switchSpace(s.id)
                }
                onContextMenu={(e) => {
                  e.preventDefault()
                  setEditingSpace(s.id)
                }}
              >
                <SpaceAvatar color={s.color} color2={s.color2} icon={s.icon} size={size} />
                {waiting?.call && (
                  <span className={'space-ring ' + waiting.call} aria-hidden="true" />
                )}
                {waiting && !waiting.call && (
                  <span className="space-attn" aria-hidden="true">
                    {badgeText(waiting.count)}
                  </span>
                )}
                {sounding && (
                  <span
                    role="button"
                    tabIndex={0}
                    className={'space-sound' + (sound.playing ? '' : ' muted')}
                    title={sound.playing ? `Mute ${s.name}` : `Unmute ${s.name}`}
                    aria-label={sound.playing ? `Mute ${s.name}` : `Unmute ${s.name}`}
                    onClick={(e) => {
                      e.stopPropagation() // not a switch
                      window.api.muteSpace(s.id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      e.stopPropagation()
                      window.api.muteSpace(s.id)
                    }}
                  >
                    <SpeakerIcon muted={!sound.playing} />
                  </span>
                )}
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
