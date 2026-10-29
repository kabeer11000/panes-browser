import { useEffect } from 'react'
import { slideOffsets } from '../../../shared/slide'
import { rememberSlot } from './dragSettle'
import type { DragState } from './useTabDrag'

// group headers are rows too: they slide with the tabs around them
const ROWS = '.tab-row[data-tab-id], .htab[data-tab-id], .group-head, .hgroup'
const EDGE_SCROLL_PX = 48 // within this of a list's end, dragging scrolls it
const EDGE_SCROLL_STEP = 14

const listOnScreen = (): Element | null =>
  document.querySelector('.htab-list') ?? document.querySelector('.tab-list')

/**
 * While a tab is dragged along the list, the tab itself follows the pointer, and the tabs it passes slide aside to
 * open the slot it would land in, so the order is seen as it is made rather than guessed from a line. Works the
 * same along the top strip and down the sidebar. Uses the CSS `translate` property: it stacks with the transform
 * the rows animate with, and is cleared when the drag ends (the real order then arrives and the rows are already
 * where they belong).
 */
export function useTabSlide(drag: DragState | null, order: number[], group: number[]): void {
  const target = drag?.source === 'tab' && drag.target?.kind === 'list' ? drag.target.index : null
  const id = drag?.id

  useEffect(() => {
    const listEl = listOnScreen()
    const rows = [...(listEl?.querySelectorAll<HTMLElement>(ROWS) ?? [])]
    const clear = (): void => rows.forEach((el) => el.style.removeProperty('translate'))
    if (target === null || id === undefined || rows.length === 0) {
      rememberSlot(null)
      return clear()
    }

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
    const dragged: HTMLElement[] = []
    rows.forEach((el, i) => {
      if (i >= from && i < from + count) {
        el.classList.add('floating') // follows the pointer (below)
        dragged.push(el)
        return
      }
      const o = offsets[i]
      if (o === 0) el.style.removeProperty('translate')
      else el.style.translate = horizontal ? `${o}px 0` : `0 ${o}px`
    })
    rememberSlot({ els: dragged, axis: horizontal ? 'x' : 'y', offset: offsets[from] })
    return () => {
      rows.forEach((el) => {
        el.classList.remove('floating')
        el.style.removeProperty('transition')
      })
      clear()
    }
  }, [target, id, order, group])

  // The dragged tab rides the pointer, kept inside its list, and the list scrolls when it is at an end.
  const x = drag?.x
  const y = drag?.y
  const startX = drag?.startX
  const startY = drag?.startY
  useEffect(() => {
    if (target === null || id === undefined || x === undefined || y === undefined) return
    if (startX === undefined || startY === undefined) return
    const horizontal = !!document.querySelector('.htab-list')
    const moving = group.includes(id) ? group : [id]
    const els = moving
      .map((m) => document.querySelector<HTMLElement>(`[data-tab-id="${m}"].floating`))
      .filter((el): el is HTMLElement => !!el)
    const listEl = listOnScreen()
    if (els.length === 0 || !listEl) return
    const list = listEl.getBoundingClientRect()
    const parent = els[0].offsetParent as HTMLElement | null
    if (!parent) return
    const origin = parent.getBoundingClientRect()
    const first = horizontal ? els[0].offsetLeft : els[0].offsetTop
    const lastEl = els[els.length - 1]
    const last = horizontal
      ? lastEl.offsetLeft + lastEl.offsetWidth
      : lastEl.offsetTop + lastEl.offsetHeight
    const lo = (horizontal ? list.left - origin.left : list.top - origin.top) - first
    const hi = (horizontal ? list.right - origin.left : list.bottom - origin.top) - last
    const want = horizontal ? x - startX : y - startY
    const d = Math.min(Math.max(lo, hi), Math.max(Math.min(lo, hi), want))
    for (const el of els) el.style.translate = horizontal ? `${d}px 0` : `0 ${d}px`
    // a long list: keep moving it while the pointer rests at an end
    const pointer = horizontal ? x : y
    const near = horizontal ? [list.left, list.right] : [list.top, list.bottom]
    if (pointer < near[0] + EDGE_SCROLL_PX) {
      if (horizontal) listEl.scrollLeft -= EDGE_SCROLL_STEP
      else listEl.scrollTop -= EDGE_SCROLL_STEP
    } else if (pointer > near[1] - EDGE_SCROLL_PX) {
      if (horizontal) listEl.scrollLeft += EDGE_SCROLL_STEP
      else listEl.scrollTop += EDGE_SCROLL_STEP
    }
  }, [x, y, startX, startY, target, id, group])
}
