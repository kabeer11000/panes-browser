import { describe, expect, test } from 'bun:test'
import {
  pageCaps,
  keptBoardRow,
  keptRecent,
  RECENT_ON_BOARD,
  recentOthers,
  restRect,
  sameRect,
  seated,
  zoomPercent
} from './previewBar'

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

describe('keptRecent (the preview row holds still)', () => {
  const at = (...ids: number[]): { id: number; usedAt: number }[] =>
    ids.map((id, i) => ({ id, usedAt: 100 - i }))
  const all = (): boolean => true
  test('picking any tab in the row, the last on the right too, moves nothing', () => {
    // 5 was open; the person picks 4 (rightmost): it is now the most recent tab, yet every seat stays
    const row = [1, 2, 3, 5, 4]
    expect(keptRecent(row, at(4, 5, 1, 2, 3, 9), 4, all)).toEqual(row)
  })
  test('never longer than the board row, even with many recent tabs', () => {
    expect(keptRecent([], at(1, 2, 3, 4, 5, 6, 7, 8), 1, all)).toHaveLength(RECENT_ON_BOARD)
    expect(keptRecent([1, 2, 3, 4, 5, 6, 7], at(1, 2, 3, 4, 5, 6, 7), 1, all)).toHaveLength(
      RECENT_ON_BOARD
    )
  })
  test('opening the preview from the board row moves nothing', () => {
    const board = [3, 1, 4, 2, 5]
    expect(keptRecent(board, at(1, 2, 3, 4, 5, 6), 4, all)).toEqual(board)
  })
  test('a closed tab leaves; the others keep their order and the next recent fills the end', () => {
    expect(keptRecent([1, 2, 3, 4, 5], at(6, 1, 2, 4, 5), 1, all)).toEqual([1, 2, 4, 5, 6])
  })
  test('a page from outside the row takes the rightmost seat that is not the way back', () => {
    // 5 is the way back (the page just left); 9 opened from elsewhere takes 4's seat, nothing else moves
    expect(keptRecent([1, 2, 3, 4, 5], at(9, 1, 2, 3, 4, 5), 9, all, 5)).toEqual([1, 2, 3, 9, 5])
  })
  test('with room, a page from outside joins at the end', () => {
    expect(keptRecent([1, 2], at(1, 2, 3), 3, all)).toEqual([1, 2, 3])
  })
  test('only tabs with a card on the board', () => {
    expect(keptRecent([1, 2, 3], at(1, 2, 3, 4), 1, (id) => id !== 2)).toEqual([1, 3, 4])
  })
  test('stable: asked again with the same tabs, the same row', () => {
    const tabs = at(1, 2, 3, 4, 5, 6)
    const once = keptRecent([], tabs, 2, all)
    expect(keptRecent(once, tabs, 2, all)).toEqual(once)
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

describe('seated', () => {
  const never = (): boolean => false
  test('tabs keep their seats whatever their recency now', () => {
    expect(seated([4, 2, 9], [9, 4, 2], never, 5)).toEqual([4, 2, 9])
  })
  test('a new arrival fills the seat of one that left, not the end', () => {
    expect(seated([4, 2, 9], [4, 9, 7], never, 5)).toEqual([4, 7, 9])
  })
  test('a newly opened tab joins at the left; the last makes room, never the kept one', () => {
    expect(seated([4, 2, 9], [8, 4, 2, 9], (id) => id === 8, 3, 9)).toEqual([8, 4, 9])
  })
  test('an empty row is the wanted order', () => {
    expect(seated([], [3, 1, 2], never, 2)).toEqual([3, 1])
  })
})

describe('keptBoardRow', () => {
  test('picking a tab from the board row does not move it to the front', () => {
    const before = [
      { id: 1, usedAt: 50 },
      { id: 2, usedAt: 40 },
      { id: 3, usedAt: 30 }
    ]
    const row = keptBoardRow([], before, () => true)
    expect(row).toEqual([1, 2, 3])
    // 3 picked: it is the most recent now
    const after = before.map((t) => (t.id === 3 ? { ...t, usedAt: 90 } : t))
    expect(keptBoardRow(row, after, () => true)).toEqual([1, 2, 3])
  })
  test('a tab opened since joins at the left', () => {
    const tabs = [
      { id: 1, usedAt: 50 },
      { id: 2, usedAt: 40 },
      { id: 7, usedAt: 0, openedAt: 99 }
    ]
    expect(keptBoardRow([1, 2], tabs, () => true)).toEqual([7, 1, 2])
  })
})

describe('keptRecent: the page just left stays in the row (the way back)', () => {
  // times as the window saw them: the page left still looks old (its new time reaches the window a beat later)
  const tabs = [
    { id: 1, usedAt: 9000 },
    { id: 8, usedAt: 8000 },
    { id: 7, usedAt: 7000 },
    { id: 6, usedAt: 6000 },
    { id: 5, usedAt: 100 },
    { id: 2, usedAt: 9500 }
  ]
  test('switching from 5 to 2 keeps 5, even though its time is old', () => {
    expect(keptRecent([1, 8, 7, 5], tabs, 2, () => true, 5)).toContain(5)
  })
  test('a full row: the open page takes the rightmost seat that is not the way back', () => {
    expect(keptRecent([1, 8, 7, 6, 5], tabs, 2, () => true, 5)).toEqual([1, 8, 7, 2, 5])
  })
  test('a page left that closed, or has no card, is not kept', () => {
    expect(keptRecent([1, 8, 7, 5], tabs, 2, (id) => id !== 5, 5)).not.toContain(5)
    expect(keptRecent([1, 8, 7, 5], tabs, 2, () => true, 42)).not.toContain(42)
  })
  test('the row stays as long as the board row and the open tab stays in it', () => {
    const row = keptRecent([1, 8, 7, 5], tabs, 2, () => true, 5)
    expect(row).toHaveLength(RECENT_ON_BOARD)
    expect(row).toContain(2)
    expect(new Set(row).size).toBe(row.length)
  })
})
