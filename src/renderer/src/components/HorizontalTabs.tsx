import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { leaves, type LayoutNode } from '../../../shared/layout'
import type { TabGroup } from '../../../shared/tabgroups'
import type { Space, TabInfo } from '../../../shared/types'
import { tabTitle } from '../tabTitle'
import { CloseIcon, PlusIcon, SpeakerIcon } from './icons'
import { CaptureBadge } from './CaptureBadge'
import { SpaceSwitcher } from './SpaceSwitcher'
import { GroupAudio } from './TabGroupHeader'
import { TabFavicon } from './TabFavicon'
import { WindowControls } from './WindowControls'

interface Props {
  tabs: TabInfo[]
  tabGroups: TabGroup[]
  activeId: number | null
  layout: LayoutNode | null
  spaces: Space[]
  activeSpaceId: number
  dir: number
  dragId: number | null
  dropIndex: number | null
  /** The group a dragged tab would join if dropped now. */
  dropGroupId: number | null
  onTabPointerDown: (e: PointerEvent, id: number) => void
}

/** Group label chip: colour dot and name; click folds the group, double-click renames, right-click opens the menu. */
function GroupChip({
  group,
  count,
  members,
  renaming,
  dropTarget,
  onRename,
  onDone
}: {
  group: TabGroup
  count: number
  members: TabInfo[]
  renaming: boolean
  dropTarget: boolean
  onRename: () => void
  onDone: () => void
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(group.name)
  useEffect(() => {
    if (renaming) input.current?.select()
  }, [renaming])
  const finish = (save: boolean): void => {
    if (save) window.api.updateGroup(group.id, { name: draft })
    onDone()
  }
  return (
    <div
      data-group-drop={group.id}
      className={
        'hgroup no-drag' +
        (group.collapsed ? ' collapsed' : '') +
        (dropTarget ? ' drop-target' : '')
      }
      style={{ ['--gc' as string]: group.color }}
      role="button"
      tabIndex={0}
      aria-expanded={!group.collapsed}
      aria-label={`${group.name || 'Unnamed group'}, ${count} tab${count === 1 ? '' : 's'}`}
      onClick={() => !renaming && window.api.updateGroup(group.id, { collapsed: !group.collapsed })}
      onKeyDown={(e) => {
        if (renaming || (e.key !== 'Enter' && e.key !== ' ')) return
        e.preventDefault()
        window.api.updateGroup(group.id, { collapsed: !group.collapsed })
      }}
      onDoubleClick={() => {
        setDraft(group.name)
        onRename()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        window.api.groupMenu(group.id)
      }}
    >
      {renaming ? (
        <input
          ref={input}
          autoFocus
          className="hgroup-input"
          value={draft}
          maxLength={32}
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
      ) : (
        <span className="hgroup-name">{group.name || 'Group'}</span>
      )}
      <span className="hgroup-count">{count}</span>
      <GroupAudio members={members} />
    </div>
  )
}

/**
 * Tabs laid out along the top, with the spaces at the left end. The same tabs, groups, split markers,
 * drag-to-reorder and menus as the sidebar, in a row.
 */
export function HorizontalTabs({
  tabs,
  tabGroups,
  activeId,
  layout,
  spaces,
  activeSpaceId,
  dir,
  dragId,
  dropIndex,
  dropGroupId,
  onTabPointerDown
}: Props): React.JSX.Element {
  const split = layout ? leaves(layout) : []
  const list = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState<number | null>(null)
  useEffect(() => window.api.onRenameGroup(setRenaming), [])
  const groupById = new Map(tabGroups.map((g) => [g.id, g]))
  const countOf = (id: number): number => tabs.filter((t) => t.groupId === id).length

  // Keep the tab you are on in view when there are more tabs than room.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('.htab.active')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeId, tabs.length])

  // A mouse wheel scrolls the row sideways.
  const onWheel = (e: WheelEvent): void => {
    const el = list.current
    if (!el || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    el.scrollLeft += e.deltaY
  }

  // What is drawn: a folded group shows only the tab you are on. Tiles of a split are one joined unit when they
  // sit next to each other as drawn and share a group (a group's label never sits inside a pair).
  const isHidden = (t: TabInfo): boolean => {
    const g = t.groupId === null ? undefined : groupById.get(t.groupId)
    return !!g?.collapsed && t.id !== activeId
  }
  const drawn = tabs.filter((t) => !isHidden(t))
  const joins = (a: TabInfo | undefined, b: TabInfo | undefined): boolean =>
    !!a && !!b && split.includes(a.id) && split.includes(b.id) && a.groupId === b.groupId
  const pairHasActive = split.includes(activeId ?? -1)

  return (
    <div className="tabbar drag">
      {window.api.platform !== 'darwin' && <WindowControls />}
      <SpaceSwitcher
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        placement="down"
        dir={dir}
        size={22}
      />
      <span className="tabbar-sep" aria-hidden="true" />
      <div className="htab-list no-drag" ref={list} onWheel={onWheel} role="tablist">
        {tabs.flatMap((t, i) => {
          const tg = t.groupId === null ? undefined : groupById.get(t.groupId)
          const first = !!tg && tabs[i - 1]?.groupId !== t.groupId
          const chip = first && tg && (
            <GroupChip
              key={`g${tg.id}`}
              group={tg}
              count={countOf(tg.id)}
              members={tabs.filter((m) => m.groupId === tg.id)}
              renaming={renaming === tg.id}
              dropTarget={dropGroupId === tg.id}
              onRename={() => setRenaming(tg.id)}
              onDone={() => setRenaming(null)}
            />
          )
          // A folded group shows only its chip (and the tab you are on).
          if (tg?.collapsed && t.id !== activeId) return chip ? [chip] : []
          const inSplit = split.includes(t.id)
          const at = drawn.indexOf(t)
          const splitFirst = inSplit && !joins(drawn[at - 1], t)
          const splitLast = inSplit && !joins(t, drawn[at + 1])
          const lone = t.id === activeId && !inSplit
          // the toolbar's surface curves up into the active tab, or into both ends of the split it belongs to
          const footLeft = lone || (inSplit && pairHasActive && splitFirst)
          const footRight = lone || (inSplit && pairHasActive && splitLast)
          const row = (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === activeId}
              data-tab-id={t.id}
              title={tabTitle(t)}
              style={tg ? ({ ['--gc' as string]: tg.color } as React.CSSProperties) : undefined}
              className={
                'htab' +
                (t.id === activeId ? ' active' : '') +
                (tg ? ' grouped' : '') +
                (inSplit ? ' in-split' : '') +
                (inSplit && pairHasActive ? ' pair-active' : '') +
                (splitFirst ? ' split-first' : '') +
                (splitLast ? ' split-last' : '') +
                (footLeft ? ' foot-left' : '') +
                (footRight ? ' foot-right' : '') +
                (t.unloaded ? ' unloaded' : '') +
                (t.id === dragId ? ' dragging' : '') +
                (dropIndex === i ? ' drop-before' : '') +
                (dropIndex === tabs.length && i === tabs.length - 1 ? ' drop-after' : '')
              }
              onPointerDown={(e) => onTabPointerDown(e, t.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                window.api.tabMenu(t.id)
              }}
              onAuxClick={(e) => e.button === 1 && window.api.closeTab(t.id)}
            >
              {footLeft && <span className="htab-foot l" aria-hidden="true" />}
              {footRight && <span className="htab-foot r" aria-hidden="true" />}
              <TabFavicon tab={t} />
              <span className="htab-title">{tabTitle(t)}</span>
              <CaptureBadge capture={t.capture} />
              {(t.audible || t.muted) && (
                <button
                  className={'htab-btn audio' + (t.muted ? ' muted' : '')}
                  title={t.muted ? 'Unmute tab' : 'Mute tab'}
                  aria-label={t.muted ? 'Unmute tab' : 'Mute tab'}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => window.api.toggleMute(t.id)}
                >
                  <SpeakerIcon muted={t.muted} />
                </button>
              )}
              <button
                className="htab-btn close"
                title="Close tab"
                aria-label="Close tab"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => window.api.closeTab(t.id)}
              >
                <CloseIcon />
              </button>
            </div>
          )
          return chip ? [chip, row] : [row]
        })}
      </div>
      <button
        className="icon-btn no-drag htab-plus"
        title="New tab (Ctrl+T)"
        aria-label="New tab"
        onClick={() => window.api.createTab()}
      >
        <PlusIcon />
      </button>
    </div>
  )
}
