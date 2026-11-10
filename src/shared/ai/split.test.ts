import { describe, expect, test } from 'bun:test'
import {
  CARD_H,
  CARD_W,
  cardBox,
  emptyState,
  forDisk,
  setPreview,
  fitFrames,
  GAP,
  intersects,
  liftSections,
  resizeCard,
  seatSplit,
  SPLIT_CLEAR,
  syncTabs,
  tidy,
  type TabLite
} from './canvas'
import {
  arrangeSplit,
  SPLIT_GAP,
  SPLIT_INSET,
  splitBox,
  splitEdge,
  splitMembers,
  splitPick
} from './split'

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
      // padding inside the outline, and clear space round it: other cards and the section's edges keep away
      const first = s.cards.find((c) => c.id === ids[0])!
      expect(first.x - box.x).toBe(SPLIT_INSET)
      const m = SPLIT_CLEAR - 0.5
      const around = { x: box.x - m, y: box.y - m, w: box.w + m * 2, h: box.h + m * 2 }
      expect(contains(g, around)).toBe(true)
      for (const c of s.cards)
        if (!ids.includes(c.id)) expect(intersects(around, cardBox(c))).toBe(false)
      for (const c of s.cards) expect(contains(g, cardBox(c))).toBe(true)
      // and has its row to itself
      const y = s.cards.find((c) => c.id === ids[0])!.y
      expect(s.cards.filter((c) => Math.abs(c.y - y) < 0.5).length).toBe(ids.length)
      expect(arrangeSplit(s, ids)).toBe(s)
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

describe('section titles moved outside', () => {
  test('a board laid out with the title inside moves its sections’ contents up into the room, once', () => {
    const now = tidy(emptyState('b'), [tab(1), tab(2), tab(3)], [{ name: 'G', ids: [1, 2] }])
    expect(now.lay).toBe(2)
    expect(liftSections(now)).toBe(now)
    // the same board as an older run saved it: everything in a section 20px lower, the section 20px taller
    const old = {
      ...now,
      lay: undefined,
      frames: now.frames.map((f) => ({ ...f, h: f.h + 20 })),
      cards: now.cards.map((c) => (c.frame ? { ...c, y: c.y + 20 } : c))
    }
    const lifted = liftSections(old)
    expect(lifted.cards).toEqual(now.cards)
    expect(lifted.frames).toEqual(now.frames)
    expect(liftSections(lifted)).toBe(lifted)
  })
})

describe('a section holding only a split view', () => {
  test('the split and its outline fit inside, with clear space round them, from a new or an old layout', () => {
    const now = tidy(emptyState('b'), [tab(1), tab(2)], [{ name: 'E', ids: [1, 2] }])
    const old = {
      ...now,
      lay: undefined,
      frames: now.frames.map((f) => ({ ...f, h: f.h + 20 })),
      cards: now.cards.map((c) => (c.frame ? { ...c, y: c.y + 20 } : c))
    }
    for (const start of [now, liftSections(old)]) {
      const s = arrangeSplit(start, [1, 2])
      const g = s.frames.find((f) => f.name === 'E')!
      const box = splitBox(s, [1, 2])!
      const m = SPLIT_CLEAR - 0.5
      expect(contains(g, { x: box.x - m, y: box.y - m, w: box.w + m * 2, h: box.h + m * 2 })).toBe(
        true
      )
    }
  })
})

describe('a split in a section and sections hugging what is in them', () => {
  test('agree: hugging an arranged section changes nothing, so arranging settles at once', () => {
    const one = tidy(emptyState('b'), [tab(1), tab(2)], [{ name: 'E', ids: [1, 2] }])
    const tall = tidy(
      emptyState('b'),
      [1, 2, 3, 4, 5, 6, 7, 8].map((i) => tab(i)),
      [{ name: 'T', ids: [1, 2, 3, 4, 5, 6, 7, 8] }]
    )
    for (const [board, ids] of [
      [one, [1, 2]],
      [tall, [1, 2]],
      [tall, [5, 6]],
      [tall, [7, 8, 1]]
    ] as const) {
      const s = arrangeSplit(board, [...ids])
      const hugged = fitFrames(s)
      expect(hugged).toBe(s)
      expect(arrangeSplit(hugged, [...ids])).toBe(hugged)
    }
  })
})

describe('pages looked at live', () => {
  test('are remembered by address, survive saving, and are forgotten when read as words again', () => {
    const s0 = emptyState('b')
    const s1 = setPreview(s0, 'https://a.com/', true)
    expect(s1.previews).toEqual({ 'https://a.com/': 'live' })
    expect(setPreview(s1, 'https://a.com/', true)).toBe(s1)
    expect(forDisk(s1).previews).toEqual({ 'https://a.com/': 'live' })
    expect(setPreview(s1, 'https://a.com/', false).previews).toEqual({})
    expect(setPreview(s0, 'https://a.com/', false)).toBe(s0)
  })
})

describe('a section with a split view looks like any other section', () => {
  test('same width, and the outline the same distance from every edge it is near', () => {
    for (const [n, ids] of [
      [2, [1, 2]],
      [5, [4, 5]],
      [8, [1, 2]]
    ] as const) {
      const all = Array.from({ length: n }, (_, i) => i + 1)
      const plain = tidy(
        emptyState('b'),
        all.map((i) => tab(i)),
        [{ name: 'G', ids: all }]
      )
      const s = arrangeSplit(plain, [...ids])
      const g = s.frames[0]
      const box = splitBox(s, [...ids])!
      expect(g.w).toBe(plain.frames[0].w)
      expect(box.x - g.x).toBe(SPLIT_CLEAR)
      expect(g.x + g.w - (box.x + box.w)).toBeGreaterThanOrEqual(SPLIT_CLEAR)
      const above = s.cards.filter((c) => c.frame === g.id && c.y + CARD_H <= box.y)
      const top = above.length ? Math.max(...above.map((c) => c.y + CARD_H)) : g.y
      expect(box.y - top).toBe(SPLIT_CLEAR)
      const below = s.cards.filter((c) => c.frame === g.id && c.y >= box.y + box.h)
      const bottom = below.length ? Math.min(...below.map((c) => c.y)) : g.y + g.h
      expect(bottom - (box.y + box.h)).toBe(SPLIT_CLEAR)
    }
  })
})

describe('resized cards in a split view', () => {
  const noOverlap = (cs: Array<{ x: number; y: number; w?: number; h?: number }>): void => {
    for (const c of cs)
      for (const d of cs) if (c !== d) expect(intersects(cardBox(c), cardBox(d))).toBe(false)
  }
  test('loose on the board: members sit side by side at their own sizes, inside the outline, and it settles', () => {
    let s = tidy(emptyState('b'), [tab(1), tab(2), tab(3)], [{ name: 'G', ids: [1, 2, 3] }])
    s = arrangeSplit(s, [1, 2], { x: 2000, y: 2000 })
    const c1 = s.cards.find((c) => c.id === 1)!
    s = resizeCard(s, 1, { x: c1.x, y: c1.y, w: 480, h: 300 })
    s = arrangeSplit(s, [1, 2], { x: 2000, y: 2000 })
    const a = s.cards.find((c) => c.id === 1)!
    const b = s.cards.find((c) => c.id === 2)!
    expect(b.x - a.x).toBe(480 + SPLIT_GAP)
    noOverlap([a, b])
    const box = splitBox(s, [1, 2])!
    expect(contains(box, cardBox(a))).toBe(true)
    expect(contains(box, cardBox(b))).toBe(true)
    expect(arrangeSplit(s, [1, 2], { x: 2000, y: 2000 })).toBe(s)
  })
  test('in a section: a resized member keeps the section laid out round it, and it settles', () => {
    let s = tidy(
      emptyState('b'),
      [tab(1), tab(2), tab(3), tab(4)],
      [{ name: 'G', ids: [1, 2, 3, 4] }]
    )
    s = arrangeSplit(s, [1, 2])
    const c1 = s.cards.find((c) => c.id === 1)!
    s = resizeCard(s, 1, { x: c1.x, y: c1.y, w: 420, h: 340 })
    s = arrangeSplit(s, [1, 2])
    const g = s.frames.find((f) => f.name === 'G')!
    const inG = s.cards.filter((c) => c.frame === g.id)
    noOverlap(inG)
    for (const c of inG) expect(contains(g, cardBox(c))).toBe(true)
    expect(arrangeSplit(s, [1, 2])).toBe(s)
  })
})
