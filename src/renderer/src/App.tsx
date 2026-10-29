import { AnimatePresence, motion, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { applyDrop, leaves } from '../../shared/layout'
import { NONE, click, type Selection } from '../../shared/selection'
import { stackEntries } from '../../shared/stack'
import { KIND_THEME, WELCOME_THEME, isWelcome, kindOf } from '../../shared/tabkind'
import type { UpdateState } from '../../shared/update'
import { Panes } from './components/Panes'
import { SearchPalette, type Anchor } from './components/SearchPalette'
import { Sidebar } from './components/Sidebar'
import { TabStack } from './components/TabStack'
import { TaskView } from './components/TaskView'
import { AddressBar } from './components/AddressBar'
import { SharingBar } from './components/SharingBar'
import { FindBar } from './components/FindBar'
import { FeedbackIcon, GridIcon, MoreIcon, SidebarIcon, SplitIcon } from './components/icons'
import { NavButtons } from './components/NavButtons'
import { HorizontalTabs } from './components/HorizontalTabs'
import { SpaceSwitcher } from './components/SpaceSwitcher'
import { WindowControls } from './components/WindowControls'
import { useSpaceDir } from './hooks/useSpaceDir'
import { holdOverlay, releaseOverlay } from './overlay'
import { getSlide, getSlideY, setSlide, setSlideY } from './slide'
import { useScheme } from './useScheme'
import { useSwipe } from './hooks/useSwipe'
import { useTabDrag, type ClickMods } from './hooks/useTabDrag'
import { useTabHover } from './hooks/useTabHover'
import { useTabSlide } from './hooks/useTabSlide'
import { useTabs } from './hooks/useTabs'
import { DEFAULT_SETTINGS, SEARCH_ENGINES } from '../../shared/settings'
import type { LoginEdits, PasswordPrompt, Settings } from '../../shared/types'
import { chromeVars } from '../../shared/color'
import { DragLayer, DropIndicator } from './components/DragLayer'

type Mode = 'grid' | 'stack' | 'search' | null

/** The all-tabs grid is switched off for now: no button, shortcut or palette entry opens it. */
const GRID_VIEW = false

const BASE_ROW_H = 38 // tab row height at density 1

const WHEEL_PER_CARD = 160 // DOM wheel units that move the stack by one card
const SNAP_MS = 160 // idle time before the stack settles on the nearest card

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

function App(): React.JSX.Element {
  const { tabs, tabGroups, activeId, layout, thumbs, active, spaces, activeSpaceId, activeSpace } =
    useTabs()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // Opened by the pointer touching the left edge (a setting): it closes itself when the pointer leaves.
  const [openedByHover, setOpenedByHover] = useState(false)
  const openedByHoverRef = useRef(false)
  useEffect(() => {
    openedByHoverRef.current = openedByHover
  }, [openedByHover])
  // Any deliberate open or close (button, shortcut) takes the sidebar out of that automatic mode.
  const setSidebar = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setOpenedByHover(false)
    setSidebarOpen(next)
  }, [])
  // The toggle (button, Ctrl+B) on a sidebar the pointer brought out keeps it open instead of closing it.
  const toggleSidebar = useCallback(() => {
    if (openedByHoverRef.current) setOpenedByHover(false)
    else setSidebar((o) => !o)
  }, [setSidebar])
  const [mode, setModeState] = useState<Mode>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [findKey, setFindKey] = useState<number | null>(null)
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPrompt | null>(null)
  useEffect(() => window.api.onPasswordPrompt(setPasswordPrompt), [])
  const answerPassword = (answer: 'save' | 'never' | 'dismiss', edits?: LoginEdits): void => {
    window.api.answerPassword(answer, edits)
    setPasswordPrompt(null)
  }
  // The version waiting to be installed, if any: the sidebar shows a pill for it.
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  // Set from the moment Restart is chosen until the window goes: a veil says what is happening.
  const [installing, setInstalling] = useState<string | null>(null)
  useEffect(() => {
    if (!installing) return
    void holdOverlay('installing')
    return () => void releaseOverlay('installing')
  }, [installing])
  useEffect(() => {
    const apply = (s: UpdateState): void => {
      setUpdateVersion(s.kind === 'ready' ? s.version : null)
      setInstalling(s.kind === 'installing' ? s.version : null)
    }
    void window.api.getUpdateState().then(apply)
    return window.api.onUpdateState(apply)
  }, [])
  // Whether the system already opens links with Panes; asked again when you come back from its settings.
  const [isDefault, setIsDefault] = useState(true)
  useEffect(() => {
    const check = (): void => void window.api.isDefaultBrowser().then(setIsDefault)
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])
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
  // Letting go of Ctrl must not commit: the view was opened by a one-shot shortcut (a touchpad gesture sends it,
  // Ctrl is already up) or by Ctrl+wheel, and from then on it stays open until a card is chosen or Esc.
  const stackSticky = useRef(false)
  const releaseRef = useRef<Settings['paneViewRelease']>('stay')
  const stackPos = useMotionValue(0)
  const snapTimer = useRef<number | undefined>(undefined)

  const closeOverlay = useCallback(() => {
    stackSticky.current = false
    setMode(null)
  }, [setMode])

  const commitStack = useCallback(() => {
    const { tabs: ts, layout: l, activeId: a } = latest.current
    const entries = stackEntries(ts, l, a)
    const entry = entries[clamp(Math.round(stackPos.get()), 0, entries.length - 1)]
    if (entry) window.api.activateTab(entry.primaryId)
    closeOverlay()
  }, [stackPos, closeOverlay])

  const openOverlay = useCallback(
    async (m: 'grid' | 'stack' | 'search') => {
      if (m === 'grid' && !GRID_VIEW) return
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
      await holdOverlay('app', m !== 'search')
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
        // With "stay open" (Settings), letting go of Ctrl once the view is up leaves it open and the wheel alone keeps
        // scrolling; a flick that ends before it has opened still lands on the tab it reached (see releasedEarly).
        stackSticky.current = releaseRef.current === 'stay'
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
        toggleSidebar()
      } else if (cmd === 'open-stack') {
        if (modeRef.current === 'stack') return closeOverlay()
        const { tabs: ts, layout: l, activeId: id } = latest.current
        const at = stackEntries(ts, l, id).findIndex((e) => e.tabs.some((t) => t.id === id))
        stackPos.jump(Math.max(0, at))
        stackSticky.current = true
        void openOverlay('stack')
      } else if (cmd === 'toggle-taskview') {
        if (modeRef.current === 'grid') closeOverlay()
        else void openOverlay('grid')
      }
    })
    const offWheel = window.api.onStackWheel(onStackWheel)
    const offRelease = window.api.onStackRelease(() => {
      // Letting go of Ctrl lands on the card, unless the pointer is on a close button: then the stack
      // stays open (click a card or press Esc to leave), so a card can be closed with the mouse.
      if (modeRef.current === 'stack') {
        if (stackSticky.current) return
        if (!document.querySelector('.stack-close:hover')) commitStack()
      } else if (opening.current) releasedEarly.current = true
    })
    // Ctrl+wheel over the UI itself (not a page view).
    // A touchpad pinch arrives as a wheel event with ctrlKey set but no Ctrl key down: only the real key opens the view.
    let ctrlDown = false
    const onKeyState = (e: KeyboardEvent): void => {
      if (e.key === 'Control' || e.key === 'Meta') ctrlDown = e.type === 'keydown'
    }
    const onBlur = (): void => {
      ctrlDown = false
    }
    const onDomWheel = (e: WheelEvent): void => {
      if (e.ctrlKey && !ctrlDown && modeRef.current !== 'stack') return e.preventDefault() // a pinch: nothing to do
      if (!e.ctrlKey && modeRef.current !== 'stack') return
      e.preventDefault()
      onStackWheel(e.deltaY)
    }
    window.addEventListener('keydown', onKeyState)
    window.addEventListener('keyup', onKeyState)
    window.addEventListener('blur', onBlur)
    window.addEventListener('wheel', onDomWheel, { passive: false })
    return () => {
      offCmd()
      offWheel()
      offRelease()
      window.removeEventListener('wheel', onDomWheel)
      window.removeEventListener('keydown', onKeyState)
      window.removeEventListener('keyup', onKeyState)
      window.removeEventListener('blur', onBlur)
    }
  }, [closeOverlay, openOverlay, onStackWheel, commitStack, toggleSidebar, stackPos])

  // Global settings, overridden per space; everything visual hangs off CSS variables on the root.
  useEffect(() => {
    const merge = (s: Settings): Settings => ({ ...DEFAULT_SETTINGS, ...s }) // older saved files lack newer keys
    void window.api.getSettings().then((s) => setSettings(merge(s)))
    return window.api.onSettings((s) => setSettings(merge(s)))
  }, [])
  const effective = { ...settings, ...activeSpace?.ui }
  useEffect(() => {
    releaseRef.current = settings.paneViewRelease
  }, [settings.paneViewRelease])
  const rowH = Math.round(BASE_ROW_H * effective.density)
  // Along the top there is no sidebar at all: the tab bar and the toolbar row are always there.
  const horizontal = effective.tabLayout === 'horizontal'
  // the welcome tour is shown on its own: dark, with no sidebar or bars, so the whole window is the page
  const immersive = isWelcome(active?.url)
  const showSidebar = !horizontal && sidebarOpen && !immersive
  // A sidebar the pointer asked for floats over the page instead of pushing it: the page keeps its size, so
  // nothing in it is laid out or repainted for what is a glance at the tab list.
  const pushed = showSidebar && !openedByHover
  const spaceDir = useSpaceDir(spaces, activeSpaceId)
  // The hover sidebar slides in from the left while the page area, at its own size, slides over by the same
  // amount; the page views are moved by the main process in step (no layout, no snapshots, nothing resized).
  const [hoverShown, setHoverShown] = useState(false)
  useEffect(() => {
    const target = openedByHover && showSidebar ? effective.sidebarWidth : 0
    const from = getSlide()
    if (from === target) return
    const start = performance.now()
    const duration = target > 0 ? 190 : 160
    let raf = 0
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration)
      if (target > 0) setHoverShown(true)
      setSlide(from + (target - from) * (1 - Math.pow(1 - t, 3)), effective.sidebarWidth)
      if (t < 1) raf = requestAnimationFrame(step)
      else if (target === 0) {
        // Leaving hover mode hands the sidebar back to the ordinary rules, whose width transition would run from
        // the hover width down to nothing and shove the page along with it: switch transitions off across the change.
        const root = document.documentElement.classList
        root.add('no-anim')
        setHoverShown(false)
        requestAnimationFrame(() => requestAnimationFrame(() => root.remove('no-anim')))
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [openedByHover, showSidebar, effective.sidebarWidth])
  const barAutoHidden = !pushed && !horizontal && settings.autoHideTopBar
  // the sidebar and the top bar are never both brought out by the pointer: whichever came first keeps the stage
  const peeking = peekBar && !openedByHover
  const peekRef = useRef(false)
  useEffect(() => {
    peekRef.current = peeking
  }, [peeking])
  const barPx = Math.round((6 + 26 * effective.addressSize) * effective.density * effective.uiScale)
  // The top bar the pointer brings out slides down over the page area while the page area, at its own size, slides
  // down with it (the page views follow from the main process): the page is not laid out or repainted for a glance
  // at the bar, and a little of its foot runs off the window instead.
  const [barShown, setBarShown] = useState(false)
  const barOver = barAutoHidden && (peeking || barShown)
  const stripHidden =
    pushed ||
    (barAutoHidden &&
      !peeking &&
      !barShown &&
      mode !== 'search' &&
      !passwordPrompt &&
      findKey === null)
  const barTarget = barAutoHidden && peeking ? barPx : 0
  useEffect(() => {
    const from = getSlideY()
    if (from === barTarget) return
    const start = performance.now()
    const duration = barTarget > 0 ? 170 : 150
    let raf = 0
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration)
      if (barTarget > 0) setBarShown(true)
      setSlideY(from + (barTarget - from) * (1 - Math.pow(1 - t, 3)), barPx)
      if (t < 1) raf = requestAnimationFrame(step)
      else if (barTarget === 0) {
        // the bar goes back into the ordinary rules, whose transitions must not run across the change
        const root = document.documentElement.classList
        root.add('no-anim')
        setBarShown(false)
        requestAnimationFrame(() => requestAnimationFrame(() => root.remove('no-anim')))
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [barTarget, barPx])
  useEffect(() => {
    window.api.watchTopBar(barAutoHidden, barPx)
  }, [barAutoHidden, barPx])
  useEffect(() => window.api.onPeekBar(setPeekBar), [])
  useEffect(() => {
    window.api.watchSidebar(
      settings.sidebarHover && !horizontal,
      sidebarOpen,
      openedByHover,
      effective.sidebarWidth
    )
  }, [settings.sidebarHover, horizontal, sidebarOpen, openedByHover, effective.sidebarWidth])
  useEffect(
    () =>
      window.api.onSideHover((action) => {
        // The search popover hangs off the address bar, which moves when the sidebar does; leave the
        // layout alone until it is dismissed (the pointer keeps asking, so a close still follows).
        if (modeRef.current !== null) return
        if (action === 'open' && peekRef.current) return // the top bar is out: leave the sidebar for later
        setSidebarOpen(action === 'open')
        setOpenedByHover(action === 'open')
      }),
    []
  )

  const { accent, uiScale, density, addressSize, pageMargin, sidebarWidth } = effective
  // a private or Tor tab on screen makes the whole window dark, Tor's in its own purple
  const kind = kindOf(active)
  const scheme = useScheme(kind !== 'normal' || immersive ? 'dark' : activeSpace?.mode)
  const theme = immersive
    ? WELCOME_THEME
    : kind !== 'normal'
      ? KIND_THEME[kind]
      : (activeSpace ?? { color: accent, color2: null, tint: 0, grain: 0 })
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--s', String(uiScale))
    root.setProperty('--d', String(density))
    root.setProperty('--addr', String(addressSize))
    root.setProperty('--edge', `${pageMargin}px`)
    root.setProperty('--sidebar-full', `${sidebarWidth}px`)
    // colours, readable tint and the highlight, worked out once for the window and its popover views alike
    const vars = chromeVars(
      { color: theme.color, color2: theme.color2, tint: theme.tint },
      scheme === 'dark',
      accent,
      DEFAULT_SETTINGS.accent
    )
    for (const [k, v] of Object.entries(vars)) root.setProperty(k, v)
    root.setProperty('--grain', String(theme.grain))
    document.documentElement.dataset.scheme = scheme
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
    scheme
  ])

  // With the sidebar closed the save prompt is a popover view over the page; tell it where the address bar is.
  const promptOpen = passwordPrompt !== null
  useEffect(() => {
    if (showSidebar || !promptOpen) return
    const send = (): void => {
      const r = document.querySelector('.strip .address')?.getBoundingClientRect()
      if (!r) return
      window.api.setPromptAnchor({
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        theme: { scheme, color: theme.color, color2: theme.color2 ?? theme.color }
      })
    }
    send()
    // The top bar may still be sliding in when the prompt arrives; measure again once it has settled.
    const settled = window.setTimeout(send, 400)
    window.addEventListener('resize', send)
    return () => {
      window.clearTimeout(settled)
      window.removeEventListener('resize', send)
      window.api.setPromptAnchor(null)
    }
  }, [showSidebar, promptOpen, scheme, theme.color, theme.color2])

  const toggleGrid = (): void => (mode === 'grid' ? closeOverlay() : void openOverlay('grid'))

  // Tabs picked with Shift (a run) or Ctrl (one at a time). A plain click, Escape, or any change of layout ends it.
  const [picked, setPicked] = useState<Selection>(NONE)
  const pickedRef = useRef(picked)
  useEffect(() => {
    pickedRef.current = picked
  }, [picked])
  const onTabClick = useCallback((id: number, mods: ClickMods) => {
    if (!mods.shift && !mods.ctrl) {
      setPicked(NONE)
      window.api.activateTab(id)
      return
    }
    const { tabs: ts, activeId: a } = latest.current
    // a selection starts from the tab on screen, so Shift-clicking another tab picks the run between them
    const seed: Selection = a === null ? NONE : { ids: new Set([a]), anchor: a }
    const from = pickedRef.current.ids.size > 0 ? pickedRef.current : seed
    const next = click(
      from,
      ts.map((t) => t.id),
      id,
      mods
    )
    setPicked(next.ids.size > 1 ? next : NONE)
  }, [])
  const pickedIds = picked.ids
  // a new layout, space or tab count means the picked tabs are no longer what was picked
  const [seen, setSeen] = useState({ layout, activeSpaceId, count: tabs.length })
  if (
    seen.layout !== layout ||
    seen.activeSpaceId !== activeSpaceId ||
    seen.count !== tabs.length
  ) {
    setSeen({ layout, activeSpaceId, count: tabs.length })
    setPicked(NONE)
  }
  useEffect(() => {
    if (pickedIds.size === 0) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPicked(NONE)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickedIds])

  useTabHover()
  // the downloads bin is tucked off the window while the pane view is open over that edge
  useEffect(() => {
    window.api.hideDock(mode === 'stack' || mode === 'grid')
  }, [mode])

  const { drag, start: startDrag } = useTabDrag(onTabClick, () => ({
    order: latest.current.tabs.map((t) => t.id),
    groups: latest.current.tabs.map((t) => t.groupId),
    group: latest.current.layout ? leaves(latest.current.layout) : [],
    picked: [...pickedRef.current.ids],
    tiled:
      !!latest.current.layout &&
      latest.current.activeId !== null &&
      leaves(latest.current.layout).includes(latest.current.activeId)
  }))

  // The group a drop would put the tab in: its label lights up. Dropping on the label itself joins too.
  const dropGroupId =
    drag?.target?.kind === 'group'
      ? drag.target.groupId
      : drag?.source === 'tab' && drag.target?.kind === 'list'
        ? drag.target.groupId
        : null
  useTabSlide(
    drag,
    tabs.map((t) => t.id),
    layout ? leaves(layout) : []
  )

  // While dragging over a pane, show the arrangement the drop would produce.
  const tiledLayout = layout && leaves(layout).includes(activeId ?? -1) ? layout : null
  const preview =
    drag?.target?.kind === 'pane'
      ? applyDrop(tiledLayout, drag.id, drag.target.tabId, drag.target.edge)
      : undefined

  const swipe = useSwipe(
    (dir) => window.api.activateTab(stepTab(tabs, activeId, dir)),
    // a swipe up on the address bar opens the panes view (the card stack), not the grid
    () => {
      const { tabs: ts, layout: l, activeId: id } = latest.current
      const at = stackEntries(ts, l, id).findIndex((e) => e.tabs.some((t) => t.id === id))
      stackPos.jump(Math.max(0, at))
      void openOverlay('stack')
    }
  )

  return (
    <div
      className={
        'app themed' +
        (showSidebar ? '' : ' sidebar-closed') +
        (hoverShown ? ' hover-open' : '') +
        (barOver ? ' bar-over' : '') +
        (immersive ? ' immersive' : '') +
        (horizontal ? ' horizontal' : '') +
        (mode ? ' overlay-open' : '')
      }
      style={{ '--sidebar-w': pushed ? 'var(--sidebar-full)' : '0px' } as React.CSSProperties}
    >
      <aside className="sidebar" inert={!showSidebar}>
        <Sidebar
          tabs={tabs}
          tabGroups={tabGroups}
          activeId={activeId}
          active={active}
          layout={layout}
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          urlDisplay={effective.urlDisplay}
          dragId={drag?.id ?? null}
          dropIndex={
            // a dragged tab is shown by the others sliding aside; a pane dragged in gets the line
            drag?.source === 'pane' && drag.target?.kind === 'list' ? drag.target.index : null
          }
          dropGroupId={dropGroupId}
          dir={spaceDir}
          onTabPointerDown={(e, id) => startDrag(e, id, 'tab')}
          picked={pickedIds}
          onOpenSearch={() => void openOverlay('search')}
          rowH={rowH}
          findKey={showSidebar ? findKey : null}
          onCloseFind={() => setFindKey(null)}
          passwordPrompt={passwordPrompt}
          onAnswerPassword={answerPassword}
          updateVersion={updateVersion}
          defaultPrompt={settings.askDefaultBrowser && !isDefault}
          peeking={openedByHover}
          onToggle={toggleSidebar}
          onTaskView={GRID_VIEW ? toggleGrid : undefined}
          onWheel={swipe}
        />
      </aside>

      <main className="main">
        {horizontal && (
          <HorizontalTabs
            tabs={tabs}
            tabGroups={tabGroups}
            activeId={activeId}
            layout={layout}
            spaces={spaces}
            activeSpaceId={activeSpaceId}
            dir={spaceDir}
            dropGroupId={dropGroupId}
            dragId={drag?.id ?? null}
            dropIndex={
              drag?.source === 'pane' && drag.target?.kind === 'list' ? drag.target.index : null
            }
            onTabPointerDown={(e, id) => startDrag(e, id, 'tab')}
            picked={pickedIds}
          />
        )}
        <div
          className={
            'strip drag' +
            (stripHidden ? ' hidden' : '') +
            (barAutoHidden && peeking ? ' peeking' : '') +
            (horizontal ? ' hstrip' : '') +
            (horizontal && effective.fullWidthAddress ? ' full' : '')
          }
          inert={stripHidden}
        >
          {/* controls on the left, buttons on the right, and the address bar in the true middle of the window */}
          <div className="strip-side start">
            {!horizontal && window.api.platform !== 'darwin' && <WindowControls />}
            {!horizontal && (
              <button
                className="icon-btn no-drag"
                onClick={() => setSidebar(true)}
                title="Show sidebar (Ctrl+B)"
              >
                <SidebarIcon />
              </button>
            )}
            {!horizontal && <span className="tabbar-sep" aria-hidden="true" />}
            {!horizontal && (
              <SpaceSwitcher
                spaces={spaces}
                activeSpaceId={activeSpaceId}
                placement="down"
                dir={spaceDir}
                size={22}
              />
            )}
            <NavButtons active={active} />
          </div>
          <AddressBar
            active={active}
            onOpen={() => void openOverlay('search')}
            urlDisplay={effective.urlDisplay}
            paneFocus={!!layout && leaves(layout).includes(activeId ?? -1)}
            onWheel={swipe}
          />
          <div className="strip-side end">
            {!showSidebar && <SharingBar tabs={tabs} activeId={activeId} />}
            {!showSidebar && findKey !== null && (
              <FindBar focusKey={findKey} onClose={() => setFindKey(null)} />
            )}
            <button
              className="icon-btn no-drag"
              onClick={window.api.toggleSplit}
              title="Split view (Ctrl+\)"
            >
              <SplitIcon />
            </button>
            {GRID_VIEW && (
              <button
                className="icon-btn no-drag"
                onClick={toggleGrid}
                title="All tabs (Ctrl+Shift+A)"
              >
                <GridIcon />
              </button>
            )}
            <button
              className="icon-btn no-drag"
              title="Send feedback"
              aria-label="Send feedback"
              onClick={window.api.sendFeedback}
            >
              <FeedbackIcon />
            </button>
            <button
              className="icon-btn no-drag"
              title="Menu: bookmarks, history, downloads, settings"
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
        </div>
        <div
          className={
            'stage-wrap' +
            (pushed ? '' : ' with-strip') +
            (horizontal ? ' hlayout' : '') +
            (pushed && !horizontal ? ' plane' : '') +
            (!pushed && hoverShown && !horizontal ? ' plane-hover' : '') +
            ((stripHidden || barOver) && !pushed ? ' no-bar' : '')
          }
        >
          {/* With the top bar tucked away, its loading bar is gone too: show progress on the window's top edge. */}
          <AnimatePresence>
            {stripHidden && !pushed && active?.loading && (
              <motion.div
                key="rim"
                className="rim-load"
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <span />
              </motion.div>
            )}
          </AnimatePresence>
          <div className="stage">
            <Panes
              frozenBlur={settings.frozenBlur}
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
            {mode === 'stack' && effective.paneView === 'side' && (
              // the page stays in view beside the strip: a click anywhere on it leaves the view
              <div className="stack-scrim" onClick={closeOverlay} />
            )}
            <AnimatePresence
              onExitComplete={() => {
                if (modeRef.current === null) void releaseOverlay('app')
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
                    else if (id === 'sidebar') toggleSidebar()
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
                  side={effective.paneView === 'side'}
                  entries={stackEntries(tabs, layout, activeId)}
                  activeId={activeId}
                  thumbs={thumbs}
                  target={stackPos}
                  onStep={(d) => nudgeStack(d, true)}
                  onJump={(i) => stackPos.set(i)}
                  onCommit={commitStack}
                  onCancel={closeOverlay}
                  onCloseEntry={(entry) => entry.tabs.forEach((t) => window.api.closeTab(t.id))}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
      {drag && !(drag.source === 'tab' && drag.target?.kind === 'list') && (
        <DragLayer drag={drag} tab={tabs.find((t) => t.id === drag.id)} />
      )}
      {installing && (
        <div className="installing-veil" role="status" aria-live="polite">
          <span className="installing-spin" aria-hidden="true" />
          <b>Installing Panes {installing}</b>
          <span>Panes will close and open again by itself.</span>
        </div>
      )}
    </div>
  )
}

function stepTab(tabs: Array<{ id: number }>, activeId: number | null, dir: 1 | -1): number {
  const i = tabs.findIndex((t) => t.id === activeId)
  return tabs[(i + dir + tabs.length) % tabs.length].id
}

export default App
