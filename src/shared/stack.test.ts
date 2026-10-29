import { describe, expect, test } from 'bun:test'
import { insertTab, leaf } from './layout'
import { stackEntries } from './stack'
import type { TabInfo } from './types'

const tab = (id: number): TabInfo => ({
  id,
  url: `https://t${id}.test`,
  title: `t${id}`,
  favicon: null,
  loading: false,
  bookmarked: false,
  canGoBack: false,
  canGoForward: false
})

describe('stackEntries', () => {
  const tabs = [1, 2, 3, 4].map(tab)

  test('without a layout every tab is its own entry', () => {
    const e = stackEntries(tabs, null, 1)
    expect(e.map((x) => x.primaryId)).toEqual([1, 2, 3, 4])
    expect(e.every((x) => x.layout === null)).toBe(true)
  })

  test('a tiled group collapses into one entry at its first position', () => {
    const layout = insertTab(leaf(2), 2, 3, 'right')
    const e = stackEntries(tabs, layout, 3)
    expect(e).toHaveLength(3)
    expect(e.map((x) => x.tabs.map((t) => t.id))).toEqual([[1], [2, 3], [4]])
    expect(e[1].layout).toBe(layout)
  })

  test('the group entry activates the focused member, else the first', () => {
    const layout = insertTab(leaf(2), 2, 3, 'right')
    expect(stackEntries(tabs, layout, 3)[1].primaryId).toBe(3)
    expect(stackEntries(tabs, layout, 4)[1].primaryId).toBe(2)
  })
})
