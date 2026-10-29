import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type PointerEvent, type WheelEvent } from 'react'
import { leaves, type LayoutNode } from '../../../shared/layout'
import type { TabGroup } from '../../../shared/tabgroups'
import type { LoginEdits, PasswordPrompt, Settings, Space, TabInfo } from '../../../shared/types'
import { tabTitle } from '../tabTitle'
import { AddressBar } from './AddressBar'
import { FindBar } from './FindBar'
import { SavePrompt } from './SavePrompt'
import {
  BookmarkIcon,
  CloseIcon,
  DownloadIcon,
  GridIcon,
  MoreIcon,
  HistoryIcon,
  PlusIcon,
  SettingsIcon,
  SidebarIcon,
  SpeakerIcon,
  SplitIcon
} from './icons'
import { NavButtons } from './NavButtons'
import { SpaceSwitcher } from './SpaceSwitcher'
import { TabGroupHeader } from './TabGroupHeader'
import { TabFavicon } from './TabFavicon'
import { WindowControls } from './WindowControls'

interface Props {
  tabs: TabInfo[]
  tabGroups: TabGroup[]
  activeId: number | null
  active: TabInfo | null
  layout: LayoutNode | null
  spaces: Space[]
  activeSpaceId: number
  urlDisplay: Settings['urlDisplay']
  dragId: number | null
  dropIndex: number | null
  /** The group a dragged tab would join if dropped now. */
  dropGroupId: number | null
  /** 1 or -1: the side the active space sits on relative to the one before it. */
  dir: number
  onTabPointerDown: (e: PointerEvent, id: number) => void
  onOpenSearch: () => void
  rowH: number
  findKey: number | null
  onCloseFind: () => void
  passwordPrompt: PasswordPrompt | null
  /** Version of a downloaded update waiting for a restart, or null. */
  updateVersion: string | null
  /** Offer to make Panes the default browser. */
  defaultPrompt: boolean
  onAnswerPassword: (answer: 'save' | 'never' | 'dismiss', edits?: LoginEdits) => void
  /** The pointer brought the sidebar out; the toggle then keeps it open. */
  peeking: boolean
  onToggle: () => void
  onTaskView: () => void
  onWheel: (e: WheelEvent) => void
}

export function Sidebar({
  tabs,
  tabGroups,
  activeId,
  active,
  layout,
  spaces,
  activeSpaceId,
  urlDisplay,
  dragId,
  dropIndex,
  dropGroupId,
  dir,
  onTabPointerDown,
  onOpenSearch,
  rowH,
  findKey,
  onCloseFind,
  passwordPrompt,
  updateVersion,
  defaultPrompt,
  onAnswerPassword,
  peeking,
  onToggle,
  onTaskView,
  onWheel
}: Props): React.JSX.Element {
  const group = layout ? leaves(layout) : []
  const [renamingGroup, setRenamingGroup] = useState<number | null>(null)
  useEffect(() => window.api.onRenameGroup(setRenamingGroup), [])
  const groupById = new Map(tabGroups.map((g) => [g.id, g]))
  const countOf = (id: number): number => tabs.filter((t) => t.groupId === id).length

  const headerFor = (g: TabGroup): React.JSX.Element => (
    <TabGroupHeader
      key={`g${g.id}`}
      group={g}
      count={countOf(g.id)}
      members={tabs.filter((t) => t.groupId === g.id)}
      height={Math.round(rowH * 0.78)}
      renaming={renamingGroup === g.id}
      dropTarget={dropGroupId === g.id}
      onStartRename={() => setRenamingGroup(g.id)}
      onDoneRenaming={() => setRenamingGroup(null)}
    />
  )

  return (
    <div className="sidebar-inner">
      <div className="sidebar-top drag">
        {window.api.platform !== 'darwin' && <WindowControls />}
        <span className="spacer" />
        <button
          className={'icon-btn no-drag' + (peeking ? ' pin' : '')}
          onClick={onToggle}
          title={peeking ? 'Keep sidebar open (Ctrl+B)' : 'Hide sidebar (Ctrl+B)'}
          aria-pressed={peeking ? false : undefined}
        >
          <SidebarIcon />
        </button>
      </div>

      {/* history buttons grouped on the left, view buttons on the right: the row balances */}
      <div className="sidebar-nav">
        <div className="nav-capsule">
          <NavButtons active={active} />
        </div>
        <span className="spacer" />
        <button
          className="icon-btn no-drag"
          onClick={window.api.toggleSplit}
          title="Split view (Ctrl+\)"
        >
          <SplitIcon />
        </button>
        <button className="icon-btn no-drag" onClick={onTaskView} title="All tabs (Ctrl+Shift+A)">
          <GridIcon />
        </button>
        <button
          className="icon-btn no-drag"
          title="Menu: private tab, bookmarks, history, settings"
          aria-label="Menu"
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            window.api.appMenu(r.left, r.bottom + 4)
          }}
        >
          <MoreIcon />
        </button>
      </div>
      <AddressBar
        active={active}
        onOpen={onOpenSearch}
        urlDisplay={urlDisplay}
        paneFocus={group.includes(activeId ?? -1)}
        onWheel={onWheel}
      />
      {passwordPrompt && (
        <SavePrompt
          key={`${passwordPrompt.origin}|${passwordPrompt.username}|${passwordPrompt.kind}`}
          prompt={passwordPrompt}
          reveal={window.api.revealPendingPassword}
          onAnswer={onAnswerPassword}
        />
      )}

      <motion.div
        className="tab-list"
        key={activeSpaceId}
        // slide in from the side the new space sits on, so switching feels like moving along a row
        initial={{ opacity: 0, x: 28 * dir }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      >
        <AnimatePresence initial={false}>
          {tabs.flatMap((t, i) => {
            const tg = t.groupId === null ? undefined : groupById.get(t.groupId)
            // A folded group shows only its header (and the tab you are on, so you never lose it).
            if (tg?.collapsed && t.id !== activeId) {
              return tg && tabs[i - 1]?.groupId !== t.groupId ? [headerFor(tg)] : []
            }
            const header = tg && tabs[i - 1]?.groupId !== t.groupId ? headerFor(tg) : null
            const gi = group.indexOf(t.id)
            const inSplit = gi !== -1
            const row = (
              <motion.div
                key={t.id}
                layout="position"
                data-tab-id={t.id}
                className={
                  'tab-row' +
                  (t.id === activeId ? ' active' : '') +
                  (tg ? ' grouped' : '') +
                  (inSplit ? ' in-split' : '') +
                  (t.unloaded ? ' unloaded' : '') +
                  (gi === 0 ? ' group-first' : '') +
                  (inSplit && gi === group.length - 1 ? ' group-last' : '') +
                  (t.id === dragId ? ' dragging' : '') +
                  (dropIndex === i ? ' drop-before' : '') +
                  (dropIndex === tabs.length && i === tabs.length - 1 ? ' drop-after' : '')
                }
                initial={{ opacity: 0, height: 0, scale: 0.96 }}
                animate={{ opacity: 1, height: rowH, scale: 1 }}
                exit={{ opacity: 0, height: 0, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }}
                style={tg ? ({ ['--gc' as string]: tg.color } as React.CSSProperties) : undefined}
                onPointerDown={(e) => onTabPointerDown(e, t.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  window.api.tabMenu(t.id)
                }}
                onAuxClick={(e) => e.button === 1 && window.api.closeTab(t.id)}
              >
                <TabFavicon tab={t} />
                <span className="tab-title">{tabTitle(t)}</span>
                {inSplit ? (
                  <button
                    className="tab-action split-on"
                    title="Take out of split (tab stays open)"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => window.api.closePane(t.id)}
                  >
                    <SplitIcon />
                  </button>
                ) : (
                  t.id !== activeId && (
                    <button
                      className="tab-action"
                      title="Open beside current tab"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => window.api.splitWith(t.id)}
                    >
                      <SplitIcon />
                    </button>
                  )
                )}
                {(t.audible || t.muted) && (
                  <button
                    className={'tab-action tab-audio' + (t.muted ? ' muted' : '')}
                    title={t.muted ? 'Unmute tab' : 'Mute tab'}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => window.api.toggleMute(t.id)}
                  >
                    <SpeakerIcon muted={t.muted} />
                  </button>
                )}
                <button
                  className="tab-close"
                  title="Close tab"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => window.api.closeTab(t.id)}
                >
                  <CloseIcon />
                </button>
              </motion.div>
            )
            return header ? [header, row] : [row]
          })}
        </AnimatePresence>
        <button className="tab-row new" onClick={() => window.api.createTab()}>
          <PlusIcon />
          <span className="tab-title">New tab</span>
        </button>
      </motion.div>

      {findKey !== null && <FindBar focusKey={findKey} onClose={onCloseFind} />}

      <div className="sidebar-foot no-drag">
        <SpaceSwitcher
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          placement="up"
          caption
          dir={dir}
        />
        {defaultPrompt && (
          <div className="update-pill default-pill">
            <button
              type="button"
              className="pill-main"
              onClick={() => void window.api.setDefaultBrowser()}
              title="Open web links and files in Panes"
            >
              <i />
              <span>Make Panes your default browser</span>
            </button>
            <button
              type="button"
              className="pill-x"
              aria-label="Do not ask again"
              title="Do not ask again"
              onClick={() => window.api.dismissDefaultBrowser()}
            >
              <CloseIcon />
            </button>
          </div>
        )}
        {updateVersion && (
          <button
            type="button"
            className="update-pill"
            title="A new version of Panes is ready"
            onClick={() => window.api.openInternal('software')}
          >
            <i />
            <span>Update ready: {updateVersion}</span>
          </button>
        )}
        <div className="foot-icons">
          <button
            className="icon-btn"
            title="Bookmarks (Ctrl+Shift+O)"
            aria-label="Bookmarks"
            onClick={() => window.api.openInternal('bookmarks')}
          >
            <BookmarkIcon />
          </button>
          <button
            className="icon-btn"
            title="History (Ctrl+H)"
            aria-label="History"
            onClick={() => window.api.openInternal('history')}
          >
            <HistoryIcon />
          </button>
          <button
            className="icon-btn"
            title="Downloads (Ctrl+J)"
            aria-label="Downloads"
            onClick={() => window.api.openInternal('downloads')}
          >
            <DownloadIcon />
          </button>
          <span className="spacer" />
          <button
            className="icon-btn"
            title="Settings (Ctrl+,)"
            aria-label="Settings"
            onClick={() => window.api.openInternal('settings')}
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
