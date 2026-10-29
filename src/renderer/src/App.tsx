import { AnimatePresence, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { applyDrop, leaves } from '../../shared/layout'
import { stackEntries } from '../../shared/stack'
import { Panes } from './components/Panes'
import { SearchPalette, type Anchor } from './components/SearchPalette'
import { Sidebar } from './components/Sidebar'
import { TabStack } from './components/TabStack'
import { TaskView } from './components/TaskView'
import { AddressBar } from './components/AddressBar'
import { FindBar } from './components/FindBar'
import { GridIcon, SidebarIcon, SplitIcon } from './components/icons'
import { NavButtons } from './components/NavButtons'
import { WindowControls } from './components/WindowControls'
import { useSwipe } from './hooks/useSwipe'
import { useTabDrag } from './hooks/useTabDrag'
import { useTabs } from './hooks/useTabs'
import { DEFAULT_SETTINGS, SEARCH_ENGINES } from '../../shared/settings'
import type { Settings } from '../../shared/types'
import { DragLayer, DropIndicator } from './components/DragLayer'

type Mode = 'grid' | 'stack' | 'search' | null

const BASE_ROW_H = 38 // tab row height at density 1

const WHEEL_PER_CARD = 160 // DOM wheel units that move the stack by one card
const SNAP_MS = 160 // idle time before the stack settles on the nearest card

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

function App(): React.JSX.Element {
  const { tabs, activeId, layout, thumbs, active, spaces, activeSpaceId, activeSpace } = useTabs()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mode, setModeState] = useState<Mode>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [findKey, setFindKey] = useState<number | null>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null) // where the command bar grows out of
  const [peekBar, setPeekBar] = useState(false) // pointer at the top edge brings an auto-hidden top bar back

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
    const { tabs: ts, layout: l, activeId: a } = latest.current
    const entries = stackEntries(ts, l, a)
    const entry = entries[clamp(Math.round(stackPos.get()), 0, entries.length - 1)]
    if (entry) window.api.activateTab(entry.primaryId)
    closeOverlay()
  }, [stackPos, closeOverlay])

  const openOverlay = useCallback(
    async (m: 'grid' | 'stack' | 'search') => {
      if (modeRef.current) return setMode(m) // already hidden, just switch
      if (opening.current) return
      opening.current = true
      if (m === 'search') {
        const barEl = [...document.querySelectorAll<HTMLElement>('.address')]
          .filter((el) => !el.closest('[inert]'))
          .find((el) => {
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0
          })
        const bar = barEl?.getBoundingClientRect()
        const radius = barEl ? parseFloat(getComputedStyle(barEl).borderTopLeftRadius) || 8 : 8
        const stage = document.querySelector('.stage')?.getBoundingClientRect()
        setAnchor(
          bar
            ? { left: bar.left, top: bar.top, width: bar.width, height: bar.height, radius }
            : stage
              ? {
                  left: stage.left + Math.max(0, (stage.width - 600) / 2),
                  top: stage.top + 6,
                  width: Math.min(600, stage.width),
                  height: 40,
                  radius
                }
              : null
        )
      }
      await window.api.setOverlay(true, m !== 'search')
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
      const { tabs: ts, layout: l, activeId: a } = latest.current
      const n = stackEntries(ts, l, a).length
      stackPos.set(clamp(stackPos.get() + cards, 0, n - 1))
      window.clearTimeout(snapTimer.current)
      const snap = (): void => stackPos.set(clamp(Math.round(stackPos.get()), 0, n - 1))
      if (snapNow) snap()
      else snapTimer.current = window.setTimeout(snap, SNAP_MS)
    },
    [stackPos]
  )

  const onStackWheel = useCallback(
    (dy: number) => {
      if (modeRef.current === null && !opening.current) {
        const { tabs: ts, layout: l, activeId: id } = latest.current
        stackPos.jump(
          Math.max(
            0,
            stackEntries(ts, l, id).findIndex((e) => e.tabs.some((t) => t.id === id))
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

  useEffect(() => {
    const offCmd = window.api.onCommand((cmd) => {
      if (cmd === 'focus-address') {
        void openOverlay('search')
      } else if (cmd === 'find') {
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
  }, [closeOverlay, openOverlay, onStackWheel, commitStack])

  // Global settings, overridden per space; everything visual hangs off CSS variables on the root.
  useEffect(() => {
    const merge = (s: Settings): Settings => ({ ...DEFAULT_SETTINGS, ...s }) // older saved files lack newer keys
    void window.api.getSettings().then((s) => setSettings(merge(s)))
    return window.api.onSettings((s) => setSettings(merge(s)))
  }, [])
  const effective = { ...settings, ...activeSpace?.ui }
  const rowH = Math.round(BASE_ROW_H * effective.density)
  const barAutoHidden = !sidebarOpen && settings.autoHideTopBar
  const stripHidden = sidebarOpen || (barAutoHidden && !peekBar && mode !== 'search')
  const barPx = Math.round((6 + 26 * effective.addressSize) * effective.density * effective.uiScale)
  useEffect(() => {
    window.api.watchTopBar(barAutoHidden, barPx)
  }, [barAutoHidden, barPx])
  useEffect(() => window.api.onPeekBar(setPeekBar), [])

  const { accent, uiScale, density, addressSize, pageMargin, sidebarWidth } = effective
  const theme = activeSpace ?? { color: accent, color2: null, tint: 0, grain: 0 }
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--accent', accent)
    root.setProperty('--s', String(uiScale))
    root.setProperty('--d', String(density))
    root.setProperty('--addr', String(addressSize))
    root.setProperty('--edge', `${pageMargin}px`)
    root.setProperty('--sidebar-full', `${sidebarWidth}px`)
    root.setProperty('--space', theme.color)
    root.setProperty('--space2', theme.color2 ?? theme.color)
    root.setProperty('--tint', `${Math.round(theme.tint * 100)}%`)
    root.setProperty('--grain', String(theme.grain))
    document.documentElement.dataset.scheme = activeSpace?.mode ?? 'dark'
  }, [
    accent,
    uiScale,
    density,
    addressSize,
    pageMargin,
    sidebarWidth,
    theme.color,
    theme.color2,
    theme.tint,
    theme.grain,
    activeSpace?.mode
  ])

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
      className={'app themed' + (sidebarOpen ? '' : ' sidebar-closed')}
      style={{ '--sidebar-w': sidebarOpen ? 'var(--sidebar-full)' : '0px' } as React.CSSProperties}
    >
      <aside className="sidebar" inert={!sidebarOpen}>
        <Sidebar
          tabs={tabs}
          activeId={activeId}
          active={active}
          layout={layout}
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          urlDisplay={effective.urlDisplay}
          dragId={drag?.id ?? null}
          dropIndex={
            drag?.source === 'tab' && drag.target?.kind === 'list' ? drag.target.index : null
          }
          onTabPointerDown={(e, id) => startDrag(e, id, 'tab')}
          onOpenSearch={() => void openOverlay('search')}
          rowH={rowH}
          findKey={sidebarOpen ? findKey : null}
          onCloseFind={() => setFindKey(null)}
          onToggle={() => setSidebarOpen(false)}
          onTaskView={toggleGrid}
          onWheel={swipe}
        />
      </aside>

      <main className="main">
        <div className={'strip drag' + (stripHidden ? ' hidden' : '')} inert={stripHidden}>
          {window.api.platform !== 'darwin' && <WindowControls />}
          <button
            className="icon-btn no-drag"
            onClick={() => setSidebarOpen(true)}
            title="Show sidebar (Ctrl+B)"
          >
            <SidebarIcon />
          </button>
          <NavButtons active={active} />
          {!sidebarOpen && findKey !== null && (
            <FindBar focusKey={findKey} onClose={() => setFindKey(null)} />
          )}
          <AddressBar
            active={active}
            onOpen={() => void openOverlay('search')}
            urlDisplay={effective.urlDisplay}
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
          <button className="icon-btn no-drag" onClick={toggleGrid} title="All tabs (Ctrl+Shift+A)">
            <GridIcon />
          </button>
        </div>
        <div
          className={
            'stage-wrap' +
            (sidebarOpen ? '' : ' with-strip') +
            (stripHidden && !sidebarOpen ? ' no-bar' : '')
          }
        >
          <div className="stage">
            <Panes
              tabs={tabs}
              activeId={activeId}
              layout={layout}
              preview={preview}
              thumbs={thumbs}
              dragId={drag?.id ?? null}
              onHeaderPointerDown={(e, id) => startDrag(e, id, 'pane')}
              onOpenSearch={() => void openOverlay('search')}
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
                  entries={stackEntries(tabs, layout, activeId)}
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
              {mode === 'search' && (
                <SearchPalette
                  key="search"
                  tabs={tabs}
                  active={active}
                  engineName={SEARCH_ENGINES[settings.searchEngine].name}
                  variant={settings.searchStyle}
                  anchor={anchor}
                  onClose={closeOverlay}
                  onAction={(id) => {
                    closeOverlay()
                    if (id === 'new-space') window.api.createSpace()
                    else if (id === 'split') window.api.toggleSplit()
                    else if (id === 'sidebar') setSidebarOpen((o) => !o)
                    else if (id === 'pip') window.api.togglePip()
                    else if (id === 'grid') void openOverlay('grid')
                    else if (
                      id === 'settings' ||
                      id === 'history' ||
                      id === 'bookmarks' ||
                      id === 'downloads'
                    ) {
                      window.api.openInternal(id)
                    }
                  }}
                />
              )}
              {mode === 'stack' && (
                <TabStack
                  key="stack"
                  entries={stackEntries(tabs, layout, activeId)}
                  activeId={activeId}
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
