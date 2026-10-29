import { useEffect } from 'react'
import { slideOffsets } from '../../../shared/slide'
import type { DragState } from './useTabDrag'

// group headers are rows too: they slide with the tabs around them
const ROWS = '.tab-row[data-tab-id], .htab[data-tab-id], .group-head, .hgroup'

/**
 * While a tab is dragged along the list, the tabs it passes slide aside and the dragged tab's own slot
 * moves to where it would land, so the order is seen as it is made rather than guessed from a line.
 * Uses the CSS `translate` property: it stacks with the transform the rows animate with, and is cleared
 * when the drag ends (the real order then arrives and the rows are already where they belong).
 */
export function useTabSlide(drag: DragState | null, order: number[], group: number[]): void {
  const target = drag?.source === 'tab' && drag.target?.kind === 'list' ? drag.target.index : null
  const id = drag?.id

  useEffect(() => {
    const rows = [...document.querySelectorAll<HTMLElement>(ROWS)]
    const clear = (): void => rows.forEach((el) => el.style.removeProperty('translate'))
    if (target === null || id === undefined || rows.length === 0) return clear()

    const horizontal = !!document.querySelector('.htab-list')
    const start = (el: HTMLElement): number => (horizontal ? el.offsetLeft : el.offsetTop)
    const size = (el: HTMLElement): number => (horizontal ? el.offsetWidth : el.offsetHeight)
    const ids = rows.map((el) => Number(el.dataset.tabId))
    const moving = group.includes(id) ? group : [id]
    const from = ids.findIndex((t) => moving.includes(t))
    if (from === -1) return clear()
    let count = 0
    while (moving.includes(ids[from + count])) count++
    // The slot before which the tab would land, as a row position (hidden tabs have no row).
    const at = ids.findIndex((t) => order.indexOf(t) >= target)
    const to = at === -1 ? ids.length : at

    const edges = rows.map((el) => ({ start: start(el), end: start(el) + size(el) }))
    const offsets = slideOffsets(edges, from, count, to)
    rows.forEach((el, i) => {
      const o = offsets[i]
      if (o === 0) el.style.removeProperty('translate')
      else el.style.translate = horizontal ? `${o}px 0` : `0 ${o}px`
    })
    return clear
  }, [target, id, order, group])
}
