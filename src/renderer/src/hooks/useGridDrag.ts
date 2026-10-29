import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import type { StackEntry } from '../../../shared/stack'
import type { TabInfo } from '../../../shared/types'

/** Where the dragged card would land: just before or after another card. */
export interface GridOver {
  key: string
  after: boolean
}

export interface GridDrag {
  entry: StackEntry
  x: number
  y: number
  over: GridOver | null
}

const THRESHOLD = 6

/** The card under the pointer, and which side of it the pointer is on. */
function overAt(x: number, y: number, dragged: StackEntry): GridOver | null {
  for (const el of document.querySelectorAll<HTMLElement>('.grid-card[data-key]')) {
    const r = el.getBoundingClientRect()
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
    const key = el.dataset.key as string
    return key === dragged.key ? null : { key, after: x > r.left + r.width / 2 }
  }
  return null
}

/**
 * Pointer drag for the overview grid. Dragging only reorders: splitting is always an explicit
 * action (the split button or Shift+Enter), so a stray drop can never rearrange a split.
 * A press that never moves is a click. The page views are already hidden behind the grid.
 */
export function useGridDrag(
  entries: StackEntry[],
  tabs: TabInfo[],
  onClick: (entry: StackEntry) => void
): { drag: GridDrag | null; start: (e: PointerEvent, entry: StackEntry) => void } {
  const [drag, setDrag] = useState<GridDrag | null>(null)
  const latest = useRef({ entries, tabs })
  useEffect(() => {
    latest.current = { entries, tabs }
  })

  const start = useCallback(
    (e: PointerEvent, entry: StackEntry) => {
      if (e.button !== 0) return
      const sx = e.clientX
      const sy = e.clientY
      let dragging = false

      const move = (ev: globalThis.PointerEvent): void => {
        if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return
        dragging = true
        setDrag({
          entry,
          x: ev.clientX,
          y: ev.clientY,
          over: overAt(ev.clientX, ev.clientY, entry)
        })
      }
      const up = (ev: globalThis.PointerEvent): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        if (!dragging) return onClick(entry)
        const over = overAt(ev.clientX, ev.clientY, entry)
        setDrag(null)
        if (ev.type !== 'pointerup' || !over) return
        const { entries: all, tabs: order } = latest.current
        const target = all.find((x) => x.key === over.key)
        if (!target) return
        // Card position -> index in the tab list (a group's tabs are contiguous there).
        const edgeTab = (over.after ? target.tabs.slice(-1) : target.tabs.slice(0, 1))[0]
        const at = order.findIndex((t) => t.id === edgeTab.id)
        window.api.moveTab(entry.primaryId, over.after ? at + 1 : at)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [onClick]
  )

  return { drag, start }
}
