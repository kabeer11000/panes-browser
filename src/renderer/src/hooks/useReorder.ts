import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { dropIndex, moveId, sameOrder } from '@shared/order'

/** How far the pointer goes before a press becomes a drag (a click stays a click). */
const THRESHOLD = 5
/** How long a kept order waits for the new list to come back from main before it lets go anyway. */
const PENDING_MS = 1500
/** Longer than the glide into the slot on letting go (--dur), after which its inline styles are cleared. */
const SETTLE_MS = 400

type Drag = {
  id: number
  el: HTMLElement
  column: boolean
  /** The pointer's position along the axis at the start, and the item's layout start then (offset, so no transforms). */
  pos0: number
  start0: number
  /** The latest pointer position along the axis. */
  pos: number
}

const axisStart = (el: HTMLElement, column: boolean): number =>
  column ? el.offsetTop : el.offsetLeft
const axisSize = (el: HTMLElement, column: boolean): number =>
  column ? el.offsetHeight : el.offsetWidth
const siblings = (el: HTMLElement): HTMLElement[] =>
  el.parentElement ? [...el.parentElement.querySelectorAll<HTMLElement>('[data-reorder]')] : []

/**
 * Where the dragged item is drawn: under the pointer as it was picked up, kept within the list's extent. Its layout
 * start (a whole slot) changes as the order does, so the translate is whatever is left between the two. Returns its
 * middle where the pointer would have it (unclamped), for the drop place.
 */
function place(d: Drag): number {
  const items = siblings(d.el)
  const lo = Math.min(...items.map((o) => axisStart(o, d.column)))
  const hi = Math.max(...items.map((o) => axisStart(o, d.column) + axisSize(o, d.column)))
  const size = axisSize(d.el, d.column)
  const want = d.start0 + d.pos - d.pos0
  const off = Math.max(lo, Math.min(hi - size, want)) - axisStart(d.el, d.column)
  d.el.style.translate = d.column ? `0 ${off}px` : `${off}px 0`
  // where it lands goes by where the pointer has taken it, not where it is drawn: held at the top end, its middle
  // would sit exactly on the first item's and never pass it
  return want + size / 2
}

/**
 * Put a list in order by dragging an item along it (the space pickers). The dragged item follows the pointer along the
 * list's axis while the others slide aside (their own layout animation; give the dragged one none, see `dragging`).
 * The drop place is worked out from layout offsets, not on-screen rects, so a neighbour still sliding does not make it
 * flicker between two places. On letting go the item glides into its slot and `onMove(id, index)` keeps the order; the
 * new order is shown until the list comes back in it, so it does not snap back for the round trip. Escape cancels.
 * Items are found by `data-reorder` on the dragged item's siblings; the axis is the one they are laid out along (a
 * column or a row). A press that never moved past THRESHOLD is an ordinary click; one that did never clicks.
 */
export function useReorder<T extends { id: number }>(
  items: readonly T[],
  onMove: (id: number, to: number) => void
): {
  /** The items in the order to show them: the dragged order while a drag is on, or while it is being kept. */
  ordered: readonly T[]
  /** The item being dragged, or null. */
  dragging: number | null
  /** Spread on each item: starts a drag, and swallows the click that ends one. */
  handlers: (id: number) => {
    'data-reorder': number
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
    onClickCapture: (e: React.MouseEvent) => void
  }
} {
  const [draft, setDraft] = useState<readonly number[] | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const swallow = useRef(false)
  const drag = useRef<Drag | null>(null)
  const pending = useRef<number | undefined>(undefined)
  const itemsRef = useRef(items)
  useLayoutEffect(() => {
    itemsRef.current = items
  })

  // the order changed under the dragged item: its slot moved, so it is placed again before the frame is drawn
  useLayoutEffect(() => {
    if (drag.current) place(drag.current)
  }, [draft])

  // a kept order lets go once the list has come back in it
  useLayoutEffect(() => {
    if (
      drag.current ||
      !draft ||
      !sameOrder(
        draft,
        items.map((i) => i.id)
      )
    )
      return
    window.clearTimeout(pending.current)
    setDraft(null)
  }, [items, draft])
  useLayoutEffect(() => () => window.clearTimeout(pending.current), [])

  const start = useCallback(
    (id: number, e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || drag.current) return
      const el = e.currentTarget
      const [a, b] = siblings(el)
      if (!a || !b) return // nothing to put it beside
      // a column or a row: as the items are laid out (a menu is a block list, a chip row a flex one)
      const column = Math.abs(b.offsetTop - a.offsetTop) > Math.abs(b.offsetLeft - a.offsetLeft)
      const x0 = e.clientX
      const y0 = e.clientY
      const pointerId = e.pointerId
      let on = false
      const base = itemsRef.current.map((i) => i.id)
      let order: readonly number[] = base

      const move = (ev: PointerEvent): void => {
        if (!on) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return
          on = true
          window.clearTimeout(pending.current)
          const p0 = column ? y0 : x0
          drag.current = { id, el, column, pos0: p0, start0: axisStart(el, column), pos: p0 }
          setDragging(id)
          el.setPointerCapture?.(pointerId)
        }
        const d = drag.current!
        d.pos = column ? ev.clientY : ev.clientX
        const mid = place(d)
        // the others' middles in their layout slots (the dragged one left out), in the order shown
        const mids = siblings(el)
          .filter((o) => o !== el)
          .map((o) => axisStart(o, column) + axisSize(o, column) / 2)
          .sort((x, y) => x - y)
        const next = moveId(order, id, dropIndex(mids, mid))
        if (next !== order) {
          order = next
          setDraft(next)
        }
      }
      const end = (keep: boolean): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('keydown', key, true)
        if (!on) return
        drag.current = null
        swallow.current = true // the click this release fires is the drag's, not a press on the item
        window.setTimeout(() => (swallow.current = false), 0)
        if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId)
        setDragging(null)
        // glide from where it was let go into its slot
        el.style.transition = 'translate var(--dur) var(--ease), scale var(--dur-fast) var(--ease)'
        el.style.translate = '0 0'
        window.setTimeout(() => {
          if (drag.current?.el === el) return // picked up again meanwhile
          el.style.transition = ''
          el.style.translate = ''
        }, SETTLE_MS)
        const to = order.indexOf(id)
        if (!keep || sameOrder(order, base)) {
          setDraft(null)
          return
        }
        onMove(id, to)
        // shown as dropped until the list comes back in the new order (the effect on `items` lets go of it)
        pending.current = window.setTimeout(() => setDraft(null), PENDING_MS)
      }
      const up = (): void => end(true)
      const cancel = (): void => end(false)
      const key = (ev: KeyboardEvent): void => {
        if (ev.key === 'Escape' && on) cancel()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      window.addEventListener('keydown', key, true)
    },
    [onMove]
  )

  const byId = new Map(items.map((i) => [i.id, i]))
  const ordered = draft
    ? (draft.map((id) => byId.get(id)).filter(Boolean) as T[]).concat(
        items.filter((i) => !draft.includes(i.id))
      )
    : items
  return {
    ordered,
    dragging,
    handlers: (id) => ({
      'data-reorder': id,
      onPointerDown: (e) => start(id, e),
      onClickCapture: (e) => {
        if (!swallow.current) return
        e.preventDefault()
        e.stopPropagation()
      }
    })
  }
}
