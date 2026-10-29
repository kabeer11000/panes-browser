import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { TabGroup } from '../../../shared/tabgroups'
import type { TabInfo } from '../../../shared/types'
import { ChevronIcon, SpeakerIcon } from './icons'

/**
 * Sound from a group's tabs, on its header so a folded group still shows it. Click mutes whatever is
 * playing; when everything that was playing is muted it unmutes them instead.
 */
export function GroupAudio({ members }: { members: TabInfo[] }): React.JSX.Element | null {
  const playing = members.filter((t) => t.audible && !t.muted)
  const muted = members.filter((t) => t.muted)
  if (playing.length === 0 && muted.length === 0) return null
  const mute = playing.length > 0
  return (
    <button
      type="button"
      className={'tab-action tab-audio group-audio' + (mute ? '' : ' muted')}
      title={mute ? 'Mute this group' : 'Unmute this group'}
      aria-label={mute ? 'Mute this group' : 'Unmute this group'}
      onClick={(e) => {
        e.stopPropagation() // not a fold click
        for (const t of mute ? playing : muted) window.api.toggleMute(t.id)
      }}
    >
      <SpeakerIcon muted={!mute} />
    </button>
  )
}

interface Props {
  group: TabGroup
  count: number
  members: TabInfo[]
  height: number
  renaming: boolean
  /** A tab is being dragged over this header: dropping puts it in the group. */
  dropTarget?: boolean
  onStartRename: () => void
  onDoneRenaming: () => void
}

/** Mounted only while renaming, so every rename starts from the current name. */
function NameInput({ group, onDone }: { group: TabGroup; onDone: () => void }): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(group.name)
  const finished = useRef(false)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const finish = (save: boolean): void => {
    if (finished.current) return // Enter then blur must not save twice
    finished.current = true
    if (save) window.api.updateGroup(group.id, { name: draft })
    onDone()
  }

  return (
    <input
      ref={input}
      className="group-input"
      value={draft}
      maxLength={32}
      placeholder="Group name"
      aria-label="Group name"
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        else if (e.key === 'Escape') finish(false)
      }}
    />
  )
}

/** The row above a sidebar group: fold arrow, colour, name. Click folds, double-click renames, right-click opens the menu. */
export function TabGroupHeader({
  group,
  count,
  members,
  height,
  renaming,
  dropTarget = false,
  onStartRename,
  onDoneRenaming
}: Props): React.JSX.Element {
  const toggle = (): void => window.api.updateGroup(group.id, { collapsed: !group.collapsed })

  return (
    <motion.div
      layout="position"
      data-group-drop={group.id}
      className={
        'group-head no-drag' +
        (group.collapsed ? ' collapsed' : '') +
        (dropTarget ? ' drop-target' : '')
      }
      style={{ ['--gc' as string]: group.color }}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }}
      role="button"
      tabIndex={0}
      aria-expanded={!group.collapsed}
      aria-label={`${group.name || 'Unnamed group'}, ${count} tab${count === 1 ? '' : 's'}`}
      onClick={() => !renaming && toggle()}
      onKeyDown={(e) => {
        if (renaming || (e.key !== 'Enter' && e.key !== ' ')) return
        e.preventDefault()
        toggle()
      }}
      onDoubleClick={onStartRename}
      onContextMenu={(e) => {
        e.preventDefault()
        window.api.groupMenu(group.id)
      }}
    >
      <span className="group-chev">
        <ChevronIcon />
      </span>
      <span className="group-dot" />
      {renaming ? (
        <NameInput group={group} onDone={onDoneRenaming} />
      ) : (
        <span className="group-name">{group.name || 'Unnamed group'}</span>
      )}
      <span className="group-count">{count}</span>
      <GroupAudio members={members} />
    </motion.div>
  )
}
