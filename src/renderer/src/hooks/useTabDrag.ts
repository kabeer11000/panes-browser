import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { ROOT_TARGET, type Edge } from '../../../shared/layout'

export type DragSource = 'tab' | 'pane'

/** Box in viewport coordinates. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type DropTarget =
  { kind: 'pane'; tabId: number; edge: Edge | 'center' } | { kind: 'list'; index: number }

export interface DragState {
  id: number
  source: DragSource
  x: number
  y: number
  target: DropTarget | null
  /** Where the drop would land. Kept after leaving a pane so the indicator can glide rather than pop. */
  box: Box | null
  /** How many tabs travel with this one (a tiled group moves as a unit in the sidebar). */
  count: number
}

/** What the drag needs to know about the current tab order and tiled group. */
export interface DragContext {
  order: number[]
  group: number[]
  /** The active tab is part of a tiled group, so outer-edge docking makes sense. */
  tiled: boolean
}

const THRESHOLD = 6 // px of movement before a press becomes a drag
const ROOT_EDGE_PX = 34 // distance from the page area's outer edge that means "dock the whole layout"
const ROOT_SHARE = 0.28
const CENTER = 0.16 // fraction of a pane (each way from its middle) that means "swap/replace"

function edgeOf(x: number, y: number, r: DOMRect): Edge | 'center' {
  const nx = (x - r.left) / r.width - 0.5
  const ny = (y - r.top) / r.height - 0.5
  if (Math.abs(nx) < CENTER && Math.abs(ny) < CENTER) return 'center'
  if (Math.abs(nx) > Math.abs(ny)) return nx < 0 ? 'left' : 'right'
  return ny < 0 ? 'top' : 'bottom'
}

function boxFor(r: DOMRect, edge: Edge | 'center'): Box {
  const { left: x, top: y, width: w, height: h } = r
  switch (edge) {
    case 'left':
      return { x, y, w: w / 2, h }
    case 'right':
      return { x: x + w / 2, y, w: w / 2, h }
    case 'top':
      return { x, y, w, h: h / 2 }
    case 'bottom':
      return { x, y: y + h / 2, w, h: h / 2 }
    default:
      return { x: x + w * 0.12, y: y + h * 0.12, w: w * 0.76, h: h * 0.76 }
  }
}

/** Resolve what the pointer is over: a pane edge, a sidebar insertion slot, or nothing. */
function targetAt(
  x: number,
  y: number,
  id: number,
  ctx: DragContext
): { target: DropTarget | null; box: Box | null } {
  const within = (r: DOMRect, pad = 0): boolean =>
    x >= r.left && x <= r.right && y >= r.top - pad && y <= r.bottom + pad

  const stage = document.querySelector('.stage')?.getBoundingClientRect()
  if (ctx.tiled && stage && within(stage)) {
    const gaps: Array<[Edge, number]> = [
      ['left', x - stage.left],
      ['right', stage.right - x],
      ['top', y - stage.top],
      ['bottom', stage.bottom - y]
    ]
    const [edge, dist] = gaps.reduce((a, b) => (b[1] < a[1] ? b : a))
    if (dist < ROOT_EDGE_PX) {
      const { left: bx, top: by, width: w, height: h } = stage
      const box: Box =
        edge === 'left'
          ? { x: bx, y: by, w: w * ROOT_SHARE, h }
          : edge === 'right'
            ? { x: bx + w * (1 - ROOT_SHARE), y: by, w: w * ROOT_SHARE, h }
            : edge === 'top'
              ? { x: bx, y: by, w, h: h * ROOT_SHARE }
              : { x: bx, y: by + h * (1 - ROOT_SHARE), w, h: h * ROOT_SHARE }
      return { target: { kind: 'pane', tabId: ROOT_TARGET, edge }, box }
    }
  }

  for (const el of document.querySelectorAll<HTMLElement>('.pane-hit[data-tab-id]')) {
    const r = el.getBoundingClientRect()
    if (!within(r)) continue
    const tabId = Number(el.dataset.tabId)
    if (tabId === id) return { target: null, box: null } // dropping a pane on itself does nothing
    const edge = edgeOf(x, y, r)
    return { target: { kind: 'pane', tabId, edge }, box: boxFor(r, edge) }
  }

  const list = document.querySelector('.tab-list')?.getBoundingClientRect()
  if (list && within(list, 8)) {
    const rows = [...document.querySelectorAll<HTMLElement>('.tab-row[data-tab-id]')]
    const hit = rows.findIndex((el) => {
      const r = el.getBoundingClientRect()
      return y < r.top + r.height / 2
    })
    let index = hit === -1 ? rows.length : hit
    // A tiled group is one unit in the list: never drop into the middle of it.
    const start = ctx.group.length > 1 ? ctx.order.indexOf(ctx.group[0]) : -1
    const end = start + ctx.group.length
    if (start !== -1 && index > start && index < end)
      index = index - start <= end - index ? start : end
    return { target: { kind: 'list', index }, box: null }
  }
  return { target: null, box: null }
}

/**
 * Pointer-driven dragging for sidebar tabs and pane headers. A press that never moves past
 * the threshold is a click. While dragging, native page views are swapped for snapshots so
 * the page area can show a drop indicator.
 */
export function useTabDrag(
  onClick: (id: number) => void,
  getContext: () => DragContext
): {
  drag: DragState | null
  start: (e: PointerEvent, id: number, source: DragSource) => void
} {
  const [drag, setDrag] = useState<DragState | null>(null)
  const ctxRef = useRef(getContext)
  useEffect(() => {
    ctxRef.current = getContext
  })

  const start = useCallback(
    (e: PointerEvent, id: number, source: DragSource) => {
      if (e.button !== 0) return
      const sx = e.clientX
      const sy = e.clientY
      let dragging = false
      let overlay: Promise<void> | null = null
      let lastBox: Box | null = null
      const count = (): number => {
        const g = ctxRef.current().group
        return source === 'tab' && g.includes(id) ? g.length : 1
      }

      const move = (ev: globalThis.PointerEvent): void => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return
          dragging = true
          overlay = window.api.setOverlay(true)
        }
        const { target, box } = targetAt(ev.clientX, ev.clientY, id, ctxRef.current())
        if (box) lastBox = box
        setDrag({
          id,
          source,
          x: ev.clientX,
          y: ev.clientY,
          target,
          box: target?.kind === 'pane' ? box : lastBox,
          count: count()
        })
      }
      const up = (ev: globalThis.PointerEvent): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        if (!dragging) return onClick(id)
        const { target } = targetAt(ev.clientX, ev.clientY, id, ctxRef.current())
        setDrag(null)
        if (ev.type === 'pointerup' && target) {
          if (target.kind === 'pane') window.api.dropTab(id, target.tabId, target.edge)
          else if (source === 'tab') window.api.moveTab(id, target.index)
          else window.api.closePane(id) // a pane dragged back onto the sidebar leaves the group
        }
        void overlay?.then(() => window.api.setOverlay(false))
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [onClick]
  )

  return { drag, start }
}
