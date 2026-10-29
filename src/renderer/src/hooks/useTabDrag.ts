import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { ROOT_TARGET, type Edge } from '../../../shared/layout'
import { groupForSlot } from '../../../shared/tabgroups'
import { settleDrag } from './dragSettle'
import { holdOverlay, releaseOverlay } from '../overlay'

/** Modifier keys held when a tab was clicked. */
export interface ClickMods {
  shift: boolean
  ctrl: boolean
}

export type DragSource = 'tab' | 'pane'

/** Box in viewport coordinates. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type DropTarget =
  | { kind: 'pane'; tabId: number; edge: Edge | 'center' }
  | { kind: 'list'; index: number; groupId: number | null }
  | { kind: 'space'; spaceId: number }
  | { kind: 'group'; groupId: number }

export interface DragState {
  id: number
  /** Where the pointer was when the press began, so a dragged tab can follow it from there. */
  startX: number
  startY: number
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
  /** The group of each tab in `order` (null for none), for working out what a drop joins or leaves. */
  groups: Array<number | null>
  group: number[]
  /** Tabs picked with Shift or Ctrl: dragging one of them takes them all. */
  picked: number[]
  /** The active tab is part of a tiled group, so outer-edge docking makes sense. */
  tiled: boolean
}

/** Resolves when the main process next sends the tab state (or after a moment, if the drop changed nothing). */
function nextState(): Promise<void> {
  return new Promise((resolve) => {
    const off = window.api.onState(() => done())
    const timer = window.setTimeout(() => done(), 160)
    function done(): void {
      off()
      window.clearTimeout(timer)
      resolve()
    }
  })
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

/**
 * A row's box as the layout has it, without the sideways or vertical shift the slide animation gives it.
 * Working out where a dragged tab would land from shifted boxes would feed back into itself.
 */
function layoutRect(el: HTMLElement): DOMRect {
  const r = el.getBoundingClientRect()
  const m = /^(-?[\d.]+)(?:px)?(?:\s+(-?[\d.]+)(?:px)?)?$/.exec(el.style.translate.trim())
  if (!m) return r
  const dx = Number(m[1])
  const dy = m[2] === undefined ? 0 : Number(m[2])
  return new DOMRect(r.x - dx, r.y - dy, r.width, r.height)
}

/**
 * The group a tab dropped at `index` would be in: between two members, that group; at a group's edge, the one the
 * pointer is still over (its last tab, or from its label on), else none. `axis` is the way the list runs.
 */
function slotGroup(
  ctx: DragContext,
  moving: number[],
  index: number,
  pointer: number,
  axis: 'x' | 'y'
): number | null {
  const rest = ctx.order
    .map((t, i) => ({ t, g: ctx.groups[i] ?? null }))
    .filter((o) => !moving.includes(o.t))
  const slot = ctx.order.slice(0, index).filter((t) => !moving.includes(t)).length
  const before = slot > 0 ? rest[slot - 1] : undefined
  const after = slot < rest.length ? rest[slot] : undefined
  const gb = before?.g ?? null
  const ga = after?.g ?? null
  const edge = (el: Element | null, which: 'start' | 'end'): number | null => {
    if (!(el instanceof HTMLElement)) return null
    const r = layoutRect(el)
    return axis === 'x'
      ? which === 'start'
        ? r.left
        : r.right
      : which === 'start'
        ? r.top
        : r.bottom
  }
  const rowOf = (t: number): Element | null =>
    document.querySelector(`.htab[data-tab-id="${t}"], .tab-row[data-tab-id="${t}"]`)
  const labelOf = (g: number): Element | null =>
    document.querySelector(`.hgroup[data-group-drop="${g}"], .group-head[data-group-drop="${g}"]`)
  let inside: 'before' | 'after' | null = null
  if (gb !== null && gb !== ga && before) {
    const end = edge(rowOf(before.t), 'end')
    if (end !== null && pointer < end) inside = 'before'
  }
  if (inside === null && ga !== null && ga !== gb && after) {
    const start = edge(labelOf(ga) ?? rowOf(after.t), 'start')
    if (start !== null && pointer > start) inside = 'after'
  }
  return groupForSlot(gb, ga, inside)
}

/** The tabs that travel with the one grabbed: the picked tabs, else its tiled group, else just it. */
function travelling(ctx: DragContext, id: number): number[] {
  if (ctx.picked.length > 1 && ctx.picked.includes(id)) return ctx.picked
  return ctx.group.length > 1 && ctx.group.includes(id) ? ctx.group : [id]
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

  // A space chip under the pointer: dropping a tab there moves it to that space.
  for (const chip of document.querySelectorAll<HTMLElement>('.space-chip[data-space]')) {
    if (within(chip.getBoundingClientRect(), 4)) {
      return { target: { kind: 'space', spaceId: Number(chip.dataset.space) }, box: null }
    }
  }

  // A group's header or chip under the pointer: dropping a tab there puts it in that group.
  for (const head of document.querySelectorAll<HTMLElement>('[data-group-drop]')) {
    if (within(head.getBoundingClientRect(), 2)) {
      return { target: { kind: 'group', groupId: Number(head.dataset.groupDrop) }, box: null }
    }
  }

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

  // Tabs along the top: the insertion slot is found by sideways position, against each tab's middle.
  const hlist = document.querySelector('.htab-list')?.getBoundingClientRect()
  if (hlist && within(hlist, 10)) {
    const rows = [...document.querySelectorAll<HTMLElement>('.htab[data-tab-id]')]
    const hit = rows.findIndex((el) => {
      const r = layoutRect(el)
      return x < r.left + r.width / 2
    })
    let index = hit === -1 ? ctx.order.length : ctx.order.indexOf(Number(rows[hit].dataset.tabId))
    // a tiled group is one unit in the list: never drop into the middle of it (picked tabs are not side by side)
    const moving = travelling(ctx, id)
    const start = moving === ctx.group ? ctx.order.indexOf(ctx.group[0]) : -1
    const end = start + moving.length
    if (start !== -1 && index > start && index < end)
      index = index - start <= end - index ? start : end
    const groupId = slotGroup(ctx, moving, index, x, 'x')
    return { target: { kind: 'list', index, groupId }, box: null }
  }

  const list = document.querySelector('.tab-list')?.getBoundingClientRect()
  if (list && within(list, 8)) {
    const rows = [...document.querySelectorAll<HTMLElement>('.tab-row[data-tab-id]')]
    const hit = rows.findIndex((el) => {
      const r = layoutRect(el)
      return y < r.top + r.height / 2
    })
    // Rows hidden inside a folded group are not in the DOM, so read the position from the tab, not the row.
    let index = hit === -1 ? ctx.order.length : ctx.order.indexOf(Number(rows[hit].dataset.tabId))
    // A tiled group is one unit in the list: never drop into the middle of it.
    // a tiled group is one unit in the list: never drop into the middle of it (picked tabs are not side by side)
    const moving = travelling(ctx, id)
    const start = moving === ctx.group ? ctx.order.indexOf(ctx.group[0]) : -1
    const end = start + moving.length
    if (start !== -1 && index > start && index < end)
      index = index - start <= end - index ? start : end
    const groupId = slotGroup(ctx, moving, index, y, 'y')
    return { target: { kind: 'list', index, groupId }, box: null }
  }
  return { target: null, box: null }
}

/**
 * Pointer-driven dragging for sidebar tabs and pane headers. A press that never moves past
 * the threshold is a click. While dragging, native page views are swapped for snapshots so
 * the page area can show a drop indicator.
 */
export function useTabDrag(
  onClick: (id: number, mods: ClickMods) => void,
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
      let lastBox: Box | null = null
      const count = (): number => {
        return source === 'tab' ? travelling(ctxRef.current(), id).length : 1
      }

      const move = (ev: globalThis.PointerEvent): void => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return
          dragging = true
          void holdOverlay('drag')
        }
        const { target, box } = targetAt(ev.clientX, ev.clientY, id, ctxRef.current())
        if (box) lastBox = box
        setDrag({
          id,
          startX: sx,
          startY: sy,
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
        if (!dragging) return onClick(id, { shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey })
        const { target } = targetAt(ev.clientX, ev.clientY, id, ctxRef.current())
        void (async () => {
          // a tab dropped in its list glides into its place first, then the new order is made
          const settles = ev.type === 'pointerup' && source === 'tab' && target?.kind === 'list'
          if (settles) await settleDrag()
          // listen before asking, so the answer cannot be missed; it ends the drag's hold on the tab (below)
          const arrived = settles ? nextState() : null
          finish(ev, target)
          // The tab stays where it landed until the new order arrives: letting go of it first would show it back at its
          // old place for the moment the order takes to come round.
          if (arrived) await arrived
          setDrag(null)
          void releaseOverlay('drag')
        })()
      }
      const finish = (ev: globalThis.PointerEvent, target: DropTarget | null): void => {
        if (ev.type === 'pointerup' && target) {
          const picked = source === 'tab' ? ctxRef.current().picked : []
          const all = picked.length > 1 && picked.includes(id) ? picked : [id]
          if (target.kind === 'space')
            all.forEach((t) => window.api.moveTabToSpace(t, target.spaceId))
          else if (target.kind === 'group') {
            if (source === 'tab') all.forEach((t) => window.api.addToGroup(t, target.groupId))
          } else if (target.kind === 'pane') window.api.dropTab(id, target.tabId, target.edge)
          else if (source === 'tab') {
            if (all.length > 1) window.api.moveTabs(all, target.index, target.groupId)
            else window.api.moveTab(id, target.index, target.groupId)
          } else window.api.closePane(id) // a pane dragged back onto the sidebar leaves the group
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [onClick]
  )

  return { drag, start }
}
