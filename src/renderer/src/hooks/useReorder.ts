import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { dropIndex, moveId } from '@shared/order'

/** How far the pointer goes before a press becomes a drag (a click stays a click). */
const THRESHOLD = 5

/**
 * Put a list in order by dragging an item along it (the space pickers). While dragged the list shows the new order
 * at once (the items beside it slide aside with their own layout animation); on letting go `onMove(id, index)` keeps
 * it. Items are found by `data-reorder` on the dragged item's siblings; the axis is the one they are laid out
 * along (a column or a row). A press that never moved past THRESHOLD is an ordinary click; one that did never clicks.
 */
export function useReorder<T extends { id: number }>(
  items: readonly T[],
  onMove: (id: number, to: number) => void
): {
  /** The items in the order to show them: the dragged order while a drag is on. */
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
  const itemsRef = useRef(items)
  useLayoutEffect(() => {
    itemsRef.current = items
  })

  const start = useCallback(
    (id: number, e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      const el = e.currentTarget
      const list = el.parentElement
      if (!list) return
      // a column or a row: as the items are laid out (a menu is a block list, a chip row a flex one)
      const [a, b] = [...list.querySelectorAll<HTMLElement>('[data-reorder]')].map((o) =>
        o.getBoundingClientRect()
      )
      const column = !!a && !!b && Math.abs(b.top - a.top) > Math.abs(b.left - a.left)
      const pos = (ev: PointerEvent | React.PointerEvent): number =>
        column ? ev.clientY : ev.clientX
      const x0 = e.clientX
      const y0 = e.clientY
      let on = false
      let order: readonly number[] = itemsRef.current.map((i) => i.id)
      const move = (ev: PointerEvent): void => {
        if (!on) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return
          on = true
          setDragging(id)
          el.setPointerCapture?.(ev.pointerId)
        }
        // the others' middles where they are now (the dragged one left out), in the order shown
        const others = [...list.querySelectorAll<HTMLElement>('[data-reorder]')]
          .filter((o) => Number(o.dataset.reorder) !== id)
          .map((o) => {
            const r = o.getBoundingClientRect()
            return {
              id: Number(o.dataset.reorder),
              mid: column ? r.top + r.height / 2 : r.left + r.width / 2
            }
          })
          .sort((a, b) => a.mid - b.mid)
        const at = dropIndex(
          others.map((o) => o.mid),
          pos(ev)
        )
        const next = moveId(order, id, at)
        if (next !== order) {
          order = next
          setDraft(next)
        }
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        if (!on) return
        swallow.current = true // the click this release fires is the drag's, not a press on the item
        window.setTimeout(() => (swallow.current = false), 0)
        setDragging(null)
        setDraft(null)
        const to = order.indexOf(id)
        if (to !== itemsRef.current.findIndex((i) => i.id === id)) onMove(id, to)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
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
