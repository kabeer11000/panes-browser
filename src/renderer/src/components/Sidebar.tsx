import { AnimatePresence, motion } from 'motion/react'
import type { PointerEvent, WheelEvent } from 'react'
import { leaves, type LayoutNode } from '../../../shared/layout'
import type { TabInfo } from '../../../shared/types'
import { tabTitle } from '../tabTitle'
import { AddressBar } from './AddressBar'
import { FindBar } from './FindBar'
import {
  BookmarkIcon,
  CloseIcon,
  DownloadIcon,
  GridIcon,
  HistoryIcon,
  PlusIcon,
  SettingsIcon,
  SidebarIcon,
  SplitIcon
} from './icons'
import { NavButtons } from './NavButtons'
import { TabFavicon } from './TabFavicon'
import { WindowControls } from './WindowControls'

interface Props {
  tabs: TabInfo[]
  activeId: number | null
  active: TabInfo | null
  layout: LayoutNode | null
  dragId: number | null
  dropIndex: number | null
  onTabPointerDown: (e: PointerEvent, id: number) => void
  focusTick: number
  visible: boolean
  rowH: number
  findKey: number | null
  onCloseFind: () => void
  onToggle: () => void
  onTaskView: () => void
  onWheel: (e: WheelEvent) => void
}

export function Sidebar({
  tabs,
  activeId,
  active,
  layout,
  dragId,
  dropIndex,
  onTabPointerDown,
  focusTick,
  visible,
  rowH,
  findKey,
  onCloseFind,
  onToggle,
  onTaskView,
  onWheel
}: Props): React.JSX.Element {
  const group = layout ? leaves(layout) : []
  return (
    <div className="sidebar-inner">
      <div className="sidebar-top drag">
        {window.api.platform !== 'darwin' && <WindowControls />}
        <span className="spacer" />
        <button className="icon-btn no-drag" onClick={onToggle} title="Hide sidebar (Ctrl+B)">
          <SidebarIcon />
        </button>
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
      </div>

      <div className="sidebar-nav">
        <NavButtons active={active} />
      </div>
      <AddressBar
        active={active}
        focusTick={focusTick}
        visible={visible}
        paneFocus={group.includes(activeId ?? -1)}
        onWheel={onWheel}
      />

      <div className="tab-list" onWheel={onWheel}>
        <AnimatePresence initial={false}>
          {tabs.map((t, i) => {
            const gi = group.indexOf(t.id)
            const inSplit = gi !== -1
            return (
              <motion.div
                key={t.id}
                layout="position"
                data-tab-id={t.id}
                className={
                  'tab-row' +
                  (t.id === activeId ? ' active' : '') +
                  (inSplit ? ' in-split' : '') +
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
                onPointerDown={(e) => onTabPointerDown(e, t.id)}
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
          })}
        </AnimatePresence>
        <button className="tab-row new" onClick={() => window.api.createTab()}>
          <PlusIcon />
          <span className="tab-title">New tab</span>
        </button>
      </div>

      {findKey !== null && <FindBar focusKey={findKey} onClose={onCloseFind} />}

      <div className="sidebar-foot no-drag">
        <button
          className="icon-btn"
          title="Bookmarks (Ctrl+Shift+O)"
          onClick={() => window.api.openInternal('bookmarks')}
        >
          <BookmarkIcon />
        </button>
        <button
          className="icon-btn"
          title="History (Ctrl+H)"
          onClick={() => window.api.openInternal('history')}
        >
          <HistoryIcon />
        </button>
        <button
          className="icon-btn"
          title="Downloads (Ctrl+J)"
          onClick={() => window.api.openInternal('downloads')}
        >
          <DownloadIcon />
        </button>
        <span className="spacer" />
        <button
          className="icon-btn"
          title="Settings (Ctrl+,)"
          onClick={() => window.api.openInternal('settings')}
        >
          <SettingsIcon />
        </button>
      </div>
    </div>
  )
}
