import { AnimatePresence, motion } from 'motion/react'
import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import {
  computeFrames,
  leaf,
  leaves,
  setRatios,
  type DividerFrame,
  type Frame,
  type LayoutNode
} from '../../../shared/layout'
import type { Rect, TabInfo } from '../../../shared/types'
import { tabTitle } from '../tabTitle'
import { CloseIcon, GripIcon, PipIcon } from './icons'
import { NewTab } from './NewTab'
import { TabFavicon } from './TabFavicon'

interface Props {
  tabs: TabInfo[]
  activeId: number | null
  layout: LayoutNode | null
  /** While dragging: the arrangement a drop would produce (undefined = no preview). */
  preview?: LayoutNode | null
  thumbs: Record<number, string>
  dragId: number | null
  onHeaderPointerDown: (e: PointerEvent, id: number) => void
  onOpenSearch: () => void
  /** The saved page image behind the command bar is soft-focused rather than shown stretched and pixelated. */
  blurred?: boolean
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
  return { x: r.x, y: r.y, width: r.width, height: r.height }
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
  onOpenSearch,
  blurred = false
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
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [windowResizing, setWindowResizing] = useState(false)
  const resizeTimer = useRef<number | undefined>(undefined)
  const [live, setLive] = useState<LiveRatios | null>(null)
  const [resizing, setResizing] = useState(false)
  const overlayOpened = useRef<Promise<void> | null>(null)
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
      window.api.setContentBounds(rects)
    }
    const tick = (): void => {
      report()
      if (performance.now() < end) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [structureKey, size.w, size.h, liveKey])

  // Dragging a divider hides the native views (they would swallow pointer events).
  const startResize = (e: PointerEvent<HTMLDivElement>, div: DividerFrame): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { div, ratios: div.ratios }
    setResizing(true)
    overlayOpened.current = window.api.setOverlay(true)
  }
  const resize = (e: PointerEvent<HTMLDivElement>): void => {
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
  const endResize = (): void => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    window.api.setRatios(d.div.path, d.ratios)
    setResizing(false)
    void overlayOpened.current?.then(() => window.api.setOverlay(false))
  }

  return (
    <div
      className={
        'panes' + (resizing || windowResizing ? ' resizing' : '') + (blurred ? ' blurred' : '')
      }
      ref={containerRef}
    >
      <AnimatePresence>
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
                  onOpenSearch={onOpenSearch}
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
          style={{ left: d.frame.x, top: d.frame.y, width: d.frame.w, height: d.frame.h }}
          onPointerDown={(e) => startResize(e, d)}
          onPointerMove={resize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
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
  onOpenSearch: () => void
}

function Pane({
  tab,
  frame,
  header,
  focused,
  dragging,
  thumb,
  onHeaderPointerDown,
  onOpenSearch
}: PaneProps): React.JSX.Element {
  return (
    <motion.div
      className={'pane' + (header && focused ? ' focused' : '') + (dragging ? ' dragging' : '')}
      data-tab-id={tab.id}
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
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
          <span className="tab-title">{tabTitle(tab)}</span>
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
      <div className="pane-body" data-tab-id={tab.id}>
        {!tab.url && <NewTab onOpenSearch={onOpenSearch} />}
        {tab.pip && (
          <div className="pip-note">
            <span className="pip-note-icon">
              <PipIcon />
            </span>
            <div className="pip-note-title">This tab is playing in Picture in Picture</div>
            <button type="button" className="pip-note-btn" onClick={window.api.exitPip}>
              Return to tab
            </button>
          </div>
        )}
        {thumb && tab.url && <img className="pane-frozen" src={thumb} alt="" draggable={false} />}
      </div>
    </motion.div>
  )
}
