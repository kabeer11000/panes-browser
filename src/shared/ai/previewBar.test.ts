import { describe, expect, test } from 'bun:test'
import { pageCaps, keptRecent, recentOthers, restRect, sameRect, zoomPercent } from './previewBar'

describe('pageCaps', () => {
  test('a web page gets everything', () => {
    expect(pageCaps('https://example.com/a', false)).toEqual({
      web: true,
      bookmark: true,
      copy: true,
      site: true,
      source: true
    })
  })
  test('private tabs never bookmark, but keep the rest', () => {
    const c = pageCaps('http://example.com', true)
    expect(c.bookmark).toBe(false)
    expect(c.copy && c.site && c.source).toBe(true)
  })
  test('non-web pages get nothing', () => {
    for (const u of ['panes://settings', 'file:///C:/a.pdf', '', undefined, 'about:blank'])
      expect(pageCaps(u, false)).toEqual({
        web: false,
        bookmark: false,
        copy: false,
        site: false,
        source: false
      })
  })
})

describe('restRect', () => {
  test('takes the slide out and rounds', () => {
    expect(restRect({ x: 260.4, y: 52.6, width: 800.5, height: 600.2 }, { x: 240, y: 40 })).toEqual(
      { x: 20, y: 13, width: 801, height: 600 }
    )
  })
  test('no slide is the box itself', () => {
    expect(restRect({ x: 10, y: 20, width: 30, height: 40 }, { x: 0, y: 0 })).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40
    })
  })
  test('never a negative size', () => {
    expect(restRect({ x: 0, y: 0, width: -3, height: -1 }, { x: 0, y: 0 }).width).toBe(0)
  })
})

test('sameRect', () => {
  const a = { x: 1, y: 2, width: 3, height: 4 }
  expect(sameRect(a, { ...a })).toBe(true)
  expect(sameRect(a, { ...a, width: 5 })).toBe(false)
  expect(sameRect(null, a)).toBe(false)
})

test('zoomPercent', () => {
  expect(zoomPercent(0)).toBe(100)
  expect(zoomPercent(1)).toBe(120)
  expect(zoomPercent(-1)).toBe(83)
})

describe('recentOthers', () => {
  const tabs = [
    { id: 1, usedAt: 10 },
    { id: 2, usedAt: 50 },
    { id: 3, usedAt: 30 },
    { id: 4, usedAt: 40 },
    { id: 5, usedAt: 20 }
  ]
  test('the last used first, without the open one, three at most', () => {
    expect(recentOthers(tabs, 2, () => true)).toEqual([4, 3, 5])
  })
  test('only tabs with a card on the board', () => {
    expect(recentOthers(tabs, 2, (id) => id !== 4)).toEqual([3, 5, 1])
  })
  test('fewer tabs than asked for', () => {
    expect(recentOthers(tabs.slice(0, 2), 1, () => true)).toEqual([2])
  })
})

describe('keptRecent', () => {
  const at = (...ids: number[]): { id: number; usedAt: number }[] =>
    ids.map((id, i) => ({ id, usedAt: 100 - i }))
  test('a closed tab is replaced by the next most recent, keeping the order', () => {
    // row was [1, 2, 3, 4]; 3 closed; 5 is the most recent tab not shown
    expect(keptRecent([1, 2, 3, 4], at(5, 1, 2, 4, 6), 1, () => true)).toEqual([1, 2, 4, 5])
  })
  test('stays put when nothing closed', () => {
    expect(keptRecent([2, 1, 3, 4], at(1, 2, 3, 4, 5), 2, () => true)).toEqual([2, 1, 3, 4])
  })
  test('a card outside the row starts it afresh', () => {
    expect(keptRecent([1, 2], at(1, 2, 3), 3, () => true)).toEqual([3, 1, 2])
  })
  test('shrinks only when there is nothing left to show', () => {
    expect(keptRecent([1, 2, 3], at(1, 3), 1, () => true)).toEqual([1, 3])
  })
  test('a tab opened after the row was last used joins at the left; the last one makes room', () => {
    const tabs = [...at(1, 2, 3, 4), { id: 9, usedAt: 0, openedAt: 200 }]
    expect(keptRecent([1, 2, 3, 4], tabs, 3, () => true)).toEqual([9, 1, 2, 3])
  })
  test('the open tab never makes room, even last in the row', () => {
    const tabs = [...at(1, 2, 3, 4), { id: 9, usedAt: 0, openedAt: 200 }]
    expect(keptRecent([1, 2, 3, 4], tabs, 4, () => true)).toEqual([9, 1, 2, 4])
  })
  test('the open tab being in use now does not keep a newly opened one out', () => {
    const tabs = [
      { id: 1, usedAt: 500 },
      ...at(2, 3, 4).map((t) => ({ ...t })),
      { id: 9, usedAt: 0, openedAt: 200 }
    ]
    expect(keptRecent([1, 2, 3, 4], tabs, 1, () => true)).toEqual([9, 1, 2, 3])
  })
  test('a tab opened before the row was last used does not barge in', () => {
    const tabs = [...at(1, 2, 3, 4), { id: 9, usedAt: 0, openedAt: 50 }]
    expect(keptRecent([1, 2, 3, 4], tabs, 1, () => true)).toEqual([1, 2, 3, 4])
  })
})

describe('recentOthers, opened tabs', () => {
  test('a tab opened in the background counts as recent from when it opened', () => {
    const tabs = [
      { id: 1, usedAt: 10 },
      { id: 2, usedAt: 30 },
      { id: 3, usedAt: 0, openedAt: 40 },
      { id: 4, usedAt: 0, openedAt: 0 }
    ]
    expect(recentOthers(tabs, -1, () => true, 4)).toEqual([3, 2, 1, 4])
  })
})
