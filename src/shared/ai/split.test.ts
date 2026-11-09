import { describe, expect, test } from 'bun:test'
import {
  CARD_W,
  cardBox,
  emptyState,
  GAP,
  intersects,
  seatSplit,
  syncTabs,
  tidy,
  type TabLite
} from './canvas'
import { arrangeSplit, SPLIT_GAP, splitBox, splitEdge, splitMembers, splitPick } from './split'

type B = { x: number; y: number; w: number; h: number }
const contains = (o: B, i: B): boolean =>
  i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h

const tab = (id: number, priv = false): TabLite => ({
  id,
  url: `https://site${id}.com/`,
  private: priv
})

describe('split view on the board', () => {
  const board = tidy(
    emptyState('b'),
    [tab(1), tab(2), tab(3), tab(4)],
    [{ name: 'G', ids: [1, 2, 3] }]
  )
  test('members: the layout order, only cards on the board, two or more', () => {
    expect(splitMembers([3, 1], board)).toEqual([3, 1])
    expect(splitMembers([3, 99], board)).toEqual([])
    expect(splitMembers([], board)).toEqual([])
    const priv = syncTabs(board, [tab(1), tab(2), tab(3), tab(4), tab(5, true)]).state
    expect(splitMembers([1, 5], priv)).toEqual([])
  })
  test('in a section: it stays there, side by side in one row, and the section lays out round it', () => {
    const s = arrangeSplit(board, [3, 1])
    const g = s.frames.find((f) => f.name === 'G')!
    const a = s.cards.find((c) => c.id === 3)!
    const b = s.cards.find((c) => c.id === 1)!
    expect(a.frame).toBe(g.id)
    expect(b.frame).toBe(g.id)
    expect(b.y).toBe(a.y)
    expect(b.x - a.x).toBe(CARD_W + GAP)
    expect(s.split).toEqual([3, 1])
    // every card of the section is inside it, and none overlap
    const inG = s.cards.filter((c) => c.frame === g.id)
    expect(inG.length).toBe(3)
    for (const c of inG) expect(contains(g, cardBox(c))).toBe(true)
    for (const c of inG)
      for (const d of inG) if (c !== d) expect(intersects(cardBox(c), cardBox(d))).toBe(false)
    expect(splitBox(s, [3, 1])!.inFrame).toBe(true)
    // already arranged: nothing changes
    expect(arrangeSplit(s, [3, 1])).toBe(s)
  })
  test('inside a section its lip has room: the box clears the card above and stays inside the section', () => {
    const tall = tidy(
      emptyState('b'),
      [1, 2, 3, 4, 5, 6, 7, 8].map((i) => tab(i)),
      [{ name: 'T', ids: [1, 2, 3, 4, 5, 6, 7, 8] }]
    )
    for (const ids of [
      [5, 6],
      [1, 2],
      [7, 8, 1]
    ]) {
      const s = arrangeSplit(tall, ids)
      const g = s.frames[0]
      const box = splitBox(s, ids)!
      expect(box.inFrame).toBe(true)
      expect(contains(g, box)).toBe(true)
      for (const c of s.cards)
        if (!ids.includes(c.id)) expect(intersects(box, cardBox(c))).toBe(false)
      for (const c of s.cards) expect(contains(g, cardBox(c))).toBe(true)
    }
  })
  test('a split never wraps across rows: it starts a new one, and the section widens to fit it', () => {
    const wide = tidy(
      emptyState('b'),
      [1, 2, 3, 4, 5, 6, 7].map((i) => tab(i)),
      [{ name: 'W', ids: [1, 2, 3, 4, 5, 6, 7] }]
    )
    const ids = [7, 2, 5, 1]
    const s = arrangeSplit(wide, ids)
    const cs = ids.map((id) => s.cards.find((c) => c.id === id)!)
    for (const c of cs) expect(c.y).toBe(cs[0].y)
    for (let i = 1; i < cs.length; i++) expect(cs[i].x - cs[i - 1].x).toBe(CARD_W + GAP)
  })
  test('dropped into another section: both go in together, and the one they left closes up', () => {
    const loose = arrangeSplit(board, [3, 1], { x: 2000, y: 2000 })
    expect(loose.cards.find((c) => c.id === 3)!.frame).toBeNull()
    const other = loose.frames.find((f) => f.name !== 'G')!
    const s = seatSplit(loose, [3, 1], other.id)
    const a = s.cards.find((c) => c.id === 3)!
    const b = s.cards.find((c) => c.id === 1)!
    expect(a.frame).toBe(other.id)
    expect(b.frame).toBe(other.id)
    expect(b.y).toBe(a.y)
    expect(b.x - a.x).toBe(CARD_W + GAP)
  })
  test('loose on the board: side by side, clear of sections', () => {
    const s = arrangeSplit(board, [3, 1], { x: 2000, y: 2000 })
    const a = s.cards.find((c) => c.id === 3)!
    const b = s.cards.find((c) => c.id === 1)!
    expect(a.frame).toBeNull()
    expect(b.x - a.x).toBe(CARD_W + SPLIT_GAP)
    const box = splitBox(s, [3, 1])!
    for (const f of s.frames) expect(intersects(box, f)).toBe(false)
  })
  test('a pick for "Open side by side" is 2 to 4 cards on the board, in reading order', () => {
    expect(splitPick([1], board)).toBeNull()
    expect([...splitPick([1, 2, 3, 4, 1], board)!].sort()).toEqual([1, 2, 3, 4])
    expect(splitPick([1, 2, 3, 4, 5], board)).toBeNull()
    expect(splitPick([2, 1], board)).toEqual([1, 2])
  })
  test('a drop anywhere on a card joins them, the dropped page on the left', () => {
    const c = { x: 0, y: 0 }
    expect(splitEdge(c, { x: 10, y: 100 })).toBe('left')
    expect(splitEdge(c, { x: CARD_W - 10, y: 100 })).toBe('left')
    expect(splitEdge(c, { x: CARD_W / 2, y: 100 })).toBe('left')
    expect(splitEdge(c, { x: -10, y: 100 })).toBeNull()
  })
})
