import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import {
  computeFrames,
  leaf,
  leaves,
  setRatios,
  type DividerFrame,
  type Frame,
  type LayoutNode
} from '@shared/layout'
import type { Rect, Settings, TabInfo } from '@shared/types'
import { displayHost } from '@shared/url'
import { TabTitle } from './TabTitle'
import { CloseIcon, GripIcon } from './icons'
import { NewTab } from './NewTab'
import { TabFavicon } from './TabFavicon'
import { holdOverlay, releaseOverlay, useOverlayLive } from '@renderer/overlay'
import { TabStream } from './TabStream'
import { getSlide, getSlideY } from '@renderer/slide'

interface Props {
  tabs: TabInfo[]
  activeId: number | null
  layout: LayoutNode | null
  /** While dragging: the arrangement a drop would produce (undefined = no preview). */
  preview?: LayoutNode | null
  thumbs: Record<number, string>
  dragId: number | null
  onHeaderPointerDown: (e: PointerEvent, id: number) => void
  /** How soft the saved page image is while it stands in for the live page (the frozenBlur setting). */
  frozenBlur?: Settings['frozenBlur']
  /** Show the daily photo on blank tabs (the newTabPhoto setting). */
  newTabPhoto?: boolean
  newTabPhotoId?: number | null
  /** AI is on: blank tabs show boards, articles to go back to and a usual site (shared/newtab.ts). */
  smartNewTab?: boolean
  /** The space's colours when the new tab photo is to be dithered in them; null for the photo as it is. */
  dither?: { color: string; color2: string | null } | null
  /**
   * Where each pane's page goes, by tab. The tab view: main's page views (the default). The board's preview passes
   * its own, which places its live pages instead: the same split, the same code, in either place.
   */
  report?: (rects: Record<number, Rect>) => void
  /** A divider is being dragged (true) or let go: the pages step aside meanwhile. The default parks main's views. */
  onHold?: (on: boolean) => void
}

const GAP = 5 // the gap between tiled panes; the divider's grab area extends past it (see .divider::before)
const MIN_RATIO = 0.1
const SETTLE_MS = 700 // keep syncing native view positions while panes glide to new frames
const WINDOW_RESIZE_IDLE_MS = 160 // panes follow a resizing window instantly, then glide again

interface LiveRatios {
  base: string // layout this override was made against; stale once the layout changes
  path: number[]
  ratios: number[]
}

const toRect = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect()
  // the page area may be mid-slide (the hover sidebar or top bar): its own place is where it would be without that
  return { x: r.x - getSlide(), y: r.y - getSlideY(), width: r.width, height: r.height }
}

/**
 * Every pane is one absolutely positioned element keyed by its tab, so rearranging the tree
 * only changes frames: panes glide to their new spot instead of remounting, and fade out when
 * removed. Each pane body is a placeholder; the native page view is positioned over it
 * (positions reported to main). The pane's last snapshot sits underneath the view, so panes
 * look right while the view is hidden (dragging, fading out).
 */
export function Panes({
  tabs,
  activeId,
  layout,
  preview,
  thumbs,
  dragId,
  onHeaderPointerDown,
  frozenBlur = 'off',
  newTabPhoto = false,
  newTabPhotoId = null,
  smartNewTab = false,
  dither = null,
  report,
  onHold
}: Props): React.JSX.Element {
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const singleRoot: LayoutNode | null =
    activeId !== null && byId.has(activeId) ? leaf(activeId) : null
  const isTiled = (l: LayoutNode | null): l is LayoutNode =>
    !!l && activeId !== null && leaves(l).includes(activeId)
  // What is drawn: the live drop preview while dragging, otherwise the real layout.
  const shown = preview !== undefined ? preview : layout
  const tiled = isTiled(shown)
  const baseRoot: LayoutNode | null = isTiled(shown) ? shown : singleRoot
  const structureKey = baseRoot ? JSON.stringify(baseRoot) : ''

  const containerRef = useRef<HTMLDivElement>(null)
  const reportRef = useRef(report)
  const onHoldRef = useRef(onHold)
  useLayoutEffect(() => {
    reportRef.current = report
    onHoldRef.current = onHold
  })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [windowResizing, setWindowResizing] = useState(false)
  const resizeTimer = useRef<number | undefined>(undefined)
  const [live, setLive] = useState<LiveRatios | null>(null)
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{ div: DividerFrame; ratios: number[] } | null>(null)

  // Divider drags are applied locally and committed on release.
  const root =
    baseRoot && live && live.base === structureKey
      ? setRatios(baseRoot, live.path, live.ratios)
      : baseRoot
  const frames =
    root && size.w > 0
      ? computeFrames(root, { x: 0, y: 0, w: size.w, h: size.h }, tiled ? GAP : 0)
      : null
  const liveKey = live ? live.ratios.join(',') : ''

  // Drop targeting must use the real layout, not the preview that is moving under the pointer.
  const hitRoot = isTiled(layout) ? layout : singleRoot
  const hitFrames =
    dragId !== null && hitRoot && size.w > 0
      ? computeFrames(hitRoot, { x: 0, y: 0, w: size.w, h: size.h }, isTiled(layout) ? GAP : 0)
      : null

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    // measured now, before the first paint: the observer's first report would leave a frame with no panes
    const box = el.getBoundingClientRect()
    setSize({ w: box.width, h: box.height })
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
      setWindowResizing(true)
      window.clearTimeout(resizeTimer.current)
      resizeTimer.current = window.setTimeout(() => setWindowResizing(false), WINDOW_RESIZE_IDLE_MS)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(resizeTimer.current)
    }
  }, [])

  // Tell main where each native view goes. Runs every frame while panes are moving.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    let last = ''
    let raf = 0
    const end = performance.now() + SETTLE_MS
    const report = (): void => {
      const rects: Record<number, Rect> = {}
      for (const body of el.querySelectorAll<HTMLElement>('.pane-body')) {
        rects[Number(body.dataset.tabId)] = toRect(body)
      }
      const key = JSON.stringify(rects)
      if (key === last) return
      last = key
      ;(reportRef.current ?? window.api.setContentBounds)(rects)
    }
    const tick = (): void => {
      report()
      if (performance.now() < end) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [structureKey, size.w, size.h, liveKey])

  // Dragging a divider parks the native views (they would swallow pointer events), at once: waiting for fresh pictures
  // left the pages in place long enough for a quick drag to run onto one and be lost. The drag follows the pointer on
  // the window, not by pointer capture, which the window taking focus for the overlay could drop mid-drag.
  const resizeFns = useRef<{ move: (e: globalThis.PointerEvent) => void; end: () => void } | null>(
    null
  )
  const resize = (e: { clientX: number; clientY: number }): void => {
    const d = dragRef.current
    const box = containerRef.current?.getBoundingClientRect()
    if (!d || !box) return
    const { div } = d
    const count = div.ratios.length
    const row = div.dir === 'row'
    const total = (row ? div.parent.w : div.parent.h) - GAP * (count - 1)
    const start = row ? div.parent.x : div.parent.y
    const pointer = row ? e.clientX - box.left : e.clientY - box.top
    // Fraction of the usable space (gaps excluded) that lies before the pointer.
    const pos = (pointer - start - GAP * div.index - GAP / 2) / total
    const before = d.ratios.slice(0, div.index).reduce((a, b) => a + b, 0)
    const pair = d.ratios[div.index] + d.ratios[div.index + 1]
    const first = Math.min(pair - MIN_RATIO, Math.max(MIN_RATIO, pos - before))
    const ratios = [...d.ratios]
    ratios[div.index] = first
    ratios[div.index + 1] = pair - first
    d.ratios = ratios
    setLive({ base: structureKey, path: div.path, ratios })
  }
  const resizeRef = useRef(resize)
  useLayoutEffect(() => {
    resizeRef.current = resize
  })
  const endResize = (): void => {
    const d = dragRef.current
    const fns = resizeFns.current
    if (fns) {
      window.removeEventListener('pointermove', fns.move)
      window.removeEventListener('pointerup', fns.end)
      window.removeEventListener('pointercancel', fns.end)
      window.removeEventListener('blur', fns.end)
      resizeFns.current = null
    }
    if (!d) return
    dragRef.current = null
    window.api.setRatios(d.div.path, d.ratios)
    setResizing(false)
    if (onHoldRef.current) onHoldRef.current(false)
    else void releaseOverlay('divider')
  }
  const endRef = useRef(endResize)
  useLayoutEffect(() => {
    endRef.current = endResize
  })
  const startResize = (e: PointerEvent<HTMLDivElement>, div: DividerFrame): void => {
    if (e.button !== 0) return
    e.preventDefault() // no text selection while dragging
    endRef.current() // a drag left over (its release never arrived) ends first
    dragRef.current = { div, ratios: div.ratios }
    const fns = {
      move: (ev: globalThis.PointerEvent) => resizeRef.current(ev),
      end: () => endRef.current()
    }
    resizeFns.current = fns
    window.addEventListener('pointermove', fns.move)
    window.addEventListener('pointerup', fns.end)
    window.addEventListener('pointercancel', fns.end)
    window.addEventListener('blur', fns.end)
    setResizing(true)
    if (onHoldRef.current) onHoldRef.current(true)
    else void holdOverlay('divider', false)
  }
  useEffect(() => () => endRef.current(), [])

  return (
    <div
      className={
        'panes' +
        (resizing || windowResizing ? ' resizing' : '') +
        (frozenBlur === 'off' ? '' : ` fb-${frozenBlur}`)
      }
      ref={containerRef}
    >
      {/* no fade on mount: Panes mounts again on leaving the canvas, and the page must be there at once */}
      <AnimatePresence initial={false}>
        {frames &&
          [...frames.leaves].map(([id, frame]) => {
            const tab = byId.get(id)
            return (
              tab && (
                <Pane
                  key={id}
                  tab={tab}
                  frame={frame}
                  header={tiled}
                  focused={id === activeId}
                  dragging={id === dragId}
                  thumb={thumbs[id]}
                  onHeaderPointerDown={onHeaderPointerDown}
                  newTabPhoto={newTabPhoto}
                  newTabPhotoId={newTabPhotoId}
                  smartNewTab={smartNewTab}
                  dither={dither}
                />
              )
            )
          })}
      </AnimatePresence>
      {hitFrames &&
        [...hitFrames.leaves].map(([id, f]) => (
          <div
            key={`hit-${id}`}
            className="pane-hit"
            data-tab-id={id}
            style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
          />
        ))}
      {frames?.dividers.map((d) => (
        <div
          key={`${d.path.join('.')}:${d.index}`}
          className={'divider ' + d.dir}
          style={{
            transform: `translate(${d.frame.x}px, ${d.frame.y}px)`,
            width: d.frame.w,
            height: d.frame.h
          }}
          onPointerDown={(e) => startResize(e, d)}
          onDoubleClick={() =>
            window.api.setRatios(
              d.path,
              d.ratios.map(() => 1 / d.ratios.length)
            )
          }
        >
          <span />
        </div>
      ))}
    </div>
  )
}

interface PaneProps {
  tab: TabInfo
  frame: Frame
  header: boolean
  focused: boolean
  dragging: boolean
  thumb: string | undefined
  onHeaderPointerDown: (e: PointerEvent, id: number) => void
  newTabPhoto: boolean
  newTabPhotoId: number | null
  smartNewTab: boolean
  dither: { color: string; color2: string | null } | null
}

function Pane({
  tab,
  frame,
  header,
  focused,
  dragging,
  thumb,
  onHeaderPointerDown,
  newTabPhoto,
  newTabPhotoId,
  smartNewTab,
  dither
}: PaneProps): React.JSX.Element {
  const liveUnder = useOverlayLive()
  return (
    <motion.div
      className={'pane' + (header && focused ? ' focused' : '') + (dragging ? ' dragging' : '')}
      data-tab-id={tab.id}
      // placed by a transform, so a pane moving to a new frame is composited, not laid out (only a size change is)
      style={{
        transform: `translate(${frame.x}px, ${frame.y}px)`,
        width: frame.w,
        height: frame.h
      }}
      // A tab switch swaps the one pane at once: no cross-fade of pictures under the page (main swaps the views
      // only once the incoming page has painted). Panes of a split still fade in and out as they join or leave.
      initial={header ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={
        header
          ? { opacity: 0, transition: { duration: 0.2 } }
          : { opacity: 0, transition: { duration: 0 } }
      }
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      {header && (
        <div
          className="pane-head"
          title="Drag to rearrange. Double-click to pop out of the split."
          onPointerDown={(e) => onHeaderPointerDown(e, tab.id)}
          onDoubleClick={() => window.api.popOutPane(tab.id)}
        >
          <GripIcon />
          <TabFavicon tab={tab} />
          <TabTitle tab={tab} className="tab-title" />
          <button
            className="pane-btn"
            title="Take out of split (tab stays open)"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => window.api.closePane(tab.id)}
          >
            <CloseIcon />
          </button>
        </div>
      )}
      <div className="pane-body" data-native-view data-tab-id={tab.id}>
        {!tab.url && (
          <NewTab
            photo={newTabPhoto && !tab.private && !tab.tor}
            photoId={newTabPhotoId}
            smart={smartNewTab && !tab.private && !tab.tor}
            dither={dither}
          />
        )}
        {thumb && tab.url && <img className="pane-frozen" src={thumb} alt="" draggable={false} />}
        {/* under a popover that leaves it in view, the page goes on live over its picture */}
        {liveUnder && tab.url && <TabStream tab={tab.id} className="pane-stream" />}
        {/* A tab that has never been on screen has no snapshot: show who it is while its page loads. */}
        {!thumb && tab.url && (
          // shimmering only while it loads: under a page that has painted it was a full-pane animation nobody saw,
          // running for as long as the tab had no picture (a fifth of a core of GPU at idle)
          <div className={'pane-wait' + (tab.loading ? ' loading' : '')} aria-hidden="true">
            <TabFavicon tab={tab} noSpinner />
            <span>{displayHost(tab.url)}</span>
          </div>
        )}
      </div>
    </motion.div>
  )
}
