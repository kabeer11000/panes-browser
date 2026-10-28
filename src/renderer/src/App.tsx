import { AnimatePresence, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { applyDrop, leaves } from '../../shared/layout'
import { Panes } from './components/Panes'
import { Sidebar } from './components/Sidebar'
import { TabStack } from './components/TabStack'
import { TaskView } from './components/TaskView'
import { AddressBar } from './components/AddressBar'
import { GridIcon, SidebarIcon, SplitIcon } from './components/icons'
import { NavButtons } from './components/NavButtons'
import { WindowControls } from './components/WindowControls'
import { useSwipe } from './hooks/useSwipe'
import { useTabDrag } from './hooks/useTabDrag'
import { useTabs } from './hooks/useTabs'
import { DEFAULT_SETTINGS } from '../../shared/settings'
import type { Settings } from '../../shared/types'
import { DragLayer, DropIndicator } from './components/DragLayer'

type Mode = 'grid' | 'stack' | null

const BASE_ROW_H = 38 // tab row height at density 1

const WHEEL_PER_CARD = 160 // DOM wheel units that move the stack by one card
const SNAP_MS = 160 // idle time before the stack settles on the nearest card

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

function App(): React.JSX.Element {
  const { tabs, activeId, layout, thumbs, active } = useTabs()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mode, setModeState] = useState<Mode>(null)
  const [focusTick, setFocusTick] = useState(0)
  const [rowH, setRowH] = useState(BASE_ROW_H)
  const [findKey, setFindKey] = useState<number | null>(null)

  // Event handlers outlive renders, so they read the latest values through refs.
  const modeRef = useRef<Mode>(null)
  const latest = useRef({ tabs, activeId, layout })
  useEffect(() => {
    latest.current = { tabs, activeId, layout }
  }, [tabs, activeId, layout])
  const setMode = useCallback((m: Mode) => {
    modeRef.current = m
    setModeState(m)
  }, [])

  // ---- overlays (the native view sits above the UI, so hide it before showing one) ----
  const opening = useRef(false)
  const releasedEarly = useRef(false)
  const stackPos = useMotionValue(0)
  const snapTimer = useRef<number | undefined>(undefined)

  const closeOverlay = useCallback(() => setMode(null), [setMode])

  const commitStack = useCallback(() => {
    const { tabs: ts } = latest.current
    const t = ts[clamp(Math.round(stackPos.get()), 0, ts.length - 1)]
    if (t) window.api.activateTab(t.id)
    closeOverlay()
  }, [stackPos, closeOverlay])

  const openOverlay = useCallback(
    async (m: 'grid' | 'stack') => {
      if (modeRef.current) return setMode(m) // already hidden, just switch
      if (opening.current) return
      opening.current = true
      await window.api.setOverlay(true)
      opening.current = false
      setMode(m)
      if (m === 'stack' && releasedEarly.current) {
        releasedEarly.current = false
        commitStack()
      }
    },
    [setMode, commitStack]
  )

  const nudgeStack = useCallback(
    (cards: number, snapNow = false) => {
      const n = latest.current.tabs.length
      stackPos.set(clamp(stackPos.get() + cards, 0, n - 1))
      window.clearTimeout(snapTimer.current)
      const snap = (): void => stackPos.set(Math.round(stackPos.get()))
      if (snapNow) snap()
      else snapTimer.current = window.setTimeout(snap, SNAP_MS)
    },
    [stackPos]
  )

  const onStackWheel = useCallback(
    (dy: number) => {
      if (modeRef.current === null && !opening.current) {
        const { tabs: ts, activeId: id } = latest.current
        stackPos.jump(
          Math.max(
            0,
            ts.findIndex((t) => t.id === id)
          )
        )
        releasedEarly.current = false
        void openOverlay('stack')
      } else if (modeRef.current === 'grid') {
        setMode('stack')
      }
      nudgeStack(dy / WHEEL_PER_CARD)
    },
    [stackPos, openOverlay, nudgeStack, setMode]
  )

  const focusAddress = useCallback(() => setFocusTick((n) => n + 1), [])

  useEffect(() => {
    const offCmd = window.api.onCommand((cmd) => {
      if (cmd === 'focus-address') {
        closeOverlay()
        focusAddress()
      } else if (cmd === 'find') {
        setSidebarOpen(true)
        setFindKey((k) => (k ?? 0) + 1)
      } else if (cmd === 'toggle-sidebar') {
        setSidebarOpen((o) => !o)
      } else if (cmd === 'toggle-taskview') {
        if (modeRef.current === 'grid') closeOverlay()
        else void openOverlay('grid')
      }
    })
    const offWheel = window.api.onStackWheel(onStackWheel)
    const offRelease = window.api.onStackRelease(() => {
      if (modeRef.current === 'stack') commitStack()
      else if (opening.current) releasedEarly.current = true
    })
    // Ctrl+wheel over the UI itself (not a page view).
    const onDomWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && modeRef.current !== 'stack') return
      e.preventDefault()
      onStackWheel(e.deltaY)
    }
    window.addEventListener('wheel', onDomWheel, { passive: false })
    return () => {
      offCmd()
      offWheel()
      offRelease()
      window.removeEventListener('wheel', onDomWheel)
    }
  }, [closeOverlay, openOverlay, onStackWheel, commitStack, focusAddress])

  // Accent colour is a user setting; it drives every highlight via a CSS variable.
  useEffect(() => {
    const apply = (raw: Settings): void => {
      const s = { ...DEFAULT_SETTINGS, ...raw } // tolerate settings saved by an older version
      const root = document.documentElement.style
      root.setProperty('--accent', s.accent)
      root.setProperty('--s', String(s.uiScale))
      root.setProperty('--d', String(s.density))
      root.setProperty('--edge', `${s.pageMargin}px`)
      root.setProperty('--sidebar-full', `${s.sidebarWidth}px`)
      setRowH(Math.round(BASE_ROW_H * s.density))
    }
    void window.api.getSettings().then(apply)
    return window.api.onSettings(apply)
  }, [])

  const toggleGrid = (): void => (mode === 'grid' ? closeOverlay() : void openOverlay('grid'))

  const { drag, start: startDrag } = useTabDrag(window.api.activateTab, () => ({
    order: latest.current.tabs.map((t) => t.id),
    group: latest.current.layout ? leaves(latest.current.layout) : [],
    tiled:
      !!latest.current.layout &&
      latest.current.activeId !== null &&
      leaves(latest.current.layout).includes(latest.current.activeId)
  }))

  // While dragging over a pane, show the arrangement the drop would produce.
  const tiledLayout = layout && leaves(layout).includes(activeId ?? -1) ? layout : null
  const preview =
    drag?.target?.kind === 'pane'
      ? applyDrop(tiledLayout, drag.id, drag.target.tabId, drag.target.edge)
      : undefined

  const swipe = useSwipe(
    (dir) => window.api.activateTab(stepTab(tabs, activeId, dir)),
    () => void openOverlay('grid')
  )

  return (
    <div
      className="app"
      style={{ '--sidebar-w': sidebarOpen ? 'var(--sidebar-full)' : '0px' } as React.CSSProperties}
    >
      <aside className="sidebar">
        <Sidebar
          tabs={tabs}
          activeId={activeId}
          active={active}
          layout={layout}
          dragId={drag?.id ?? null}
          dropIndex={
            drag?.source === 'tab' && drag.target?.kind === 'list' ? drag.target.index : null
          }
          onTabPointerDown={(e, id) => startDrag(e, id, 'tab')}
          focusTick={focusTick}
          visible={sidebarOpen}
          rowH={rowH}
          findKey={findKey}
          onCloseFind={() => setFindKey(null)}
          onToggle={() => setSidebarOpen(false)}
          onTaskView={toggleGrid}
          onWheel={swipe}
        />
      </aside>

      <main className="main">
        {!sidebarOpen && (
          <div className="strip drag">
            {window.api.platform !== 'darwin' && <WindowControls />}
            <button
              className="icon-btn no-drag"
              onClick={() => setSidebarOpen(true)}
              title="Show sidebar (Ctrl+B)"
            >
              <SidebarIcon />
            </button>
            <NavButtons active={active} />
            <AddressBar
              active={active}
              focusTick={focusTick}
              visible={true}
              paneFocus={!!layout && leaves(layout).includes(activeId ?? -1)}
              onWheel={swipe}
            />
            <button
              className="icon-btn no-drag"
              onClick={window.api.toggleSplit}
              title="Split view (Ctrl+\)"
            >
              <SplitIcon />
            </button>
            <button
              className="icon-btn no-drag"
              onClick={toggleGrid}
              title="All tabs (Ctrl+Shift+A)"
            >
              <GridIcon />
            </button>
          </div>
        )}
        <div className={'stage-wrap' + (sidebarOpen ? '' : ' with-strip')}>
          <div className="stage">
            <Panes
              tabs={tabs}
              activeId={activeId}
              layout={layout}
              preview={preview}
              thumbs={thumbs}
              dragId={drag?.id ?? null}
              onHeaderPointerDown={(e, id) => startDrag(e, id, 'pane')}
            />
            {drag && <DropIndicator drag={drag} />}
            <AnimatePresence
              onExitComplete={() => {
                if (modeRef.current === null) void window.api.setOverlay(false)
              }}
            >
              {mode === 'grid' && (
                <TaskView
                  key="grid"
                  tabs={tabs}
                  activeId={activeId}
                  thumbs={thumbs}
                  onPick={(id) => {
                    window.api.activateTab(id)
                    closeOverlay()
                  }}
                  onNew={() => {
                    window.api.createTab()
                    closeOverlay()
                  }}
                  onClose={closeOverlay}
                />
              )}
              {mode === 'stack' && (
                <TabStack
                  key="stack"
                  tabs={tabs}
                  thumbs={thumbs}
                  target={stackPos}
                  onStep={(d) => nudgeStack(d, true)}
                  onJump={(i) => stackPos.set(i)}
                  onCommit={commitStack}
                  onCancel={closeOverlay}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
      {drag && <DragLayer drag={drag} tab={tabs.find((t) => t.id === drag.id)} />}
    </div>
  )
}

function stepTab(tabs: Array<{ id: number }>, activeId: number | null, dir: 1 | -1): number {
  const i = tabs.findIndex((t) => t.id === activeId)
  return tabs[(i + dir + tabs.length) % tabs.length].id
}

export default App
