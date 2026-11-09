import { describe, expect, test } from 'bun:test'
import {
  addFrame,
  addNote,
  assignByCentroid,
  boundsOf,
  CARD_H,
  CARD_W,
  cardBox,
  clusterable,
  deleteFrame,
  dropCards,
  emptyState,
  fitView,
  forDisk,
  frameAt,
  freeSpot,
  hostClusters,
  intersects,
  moveFrame,
  moveToFrame,
  nearestCard,
  OTHER_ID,
  packShelves,
  PRIVATE_ID,
  reconcileSaved,
  renameFrame,
  syncTabs,
  tidy,
  type Box,
  type CanvasState,
  type TabLite
} from './canvas'

const tab = (id: number, host = `site${id}.com`, priv = false): TabLite => ({
  id,
  url: `https://${host}/p${id}`,
  private: priv
})
const tabs = (n: number, from = 1): TabLite[] => Array.from({ length: n }, (_, i) => tab(from + i))
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i)

/** No two frames, notes or loose cards overlap, and every card of a frame sits inside it, none on another. */
function expectClean(s: CanvasState): void {
  const boxes: Box[] = [...s.frames, ...s.notes]
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) expect(intersects(boxes[i], boxes[j])).toBe(false)
  }
  for (const c of s.cards) {
    const f = s.frames.find((x) => x.id === c.frame)
    if (c.frame !== null) {
      expect(f).toBeDefined()
      const b = cardBox(c)
      expect(
        b.x >= f!.x && b.y >= f!.y && b.x + b.w <= f!.x + f!.w && b.y + b.h <= f!.y + f!.h
      ).toBe(true)
    }
  }
  for (let i = 0; i < s.cards.length; i++) {
    for (let j = i + 1; j < s.cards.length; j++) {
      expect(intersects(cardBox(s.cards[i]), cardBox(s.cards[j]))).toBe(false)
    }
  }
}

describe('packShelves / freeSpot', () => {
  test('packs without overlap and steps round obstacles', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, w: 300 + i * 10, h: 200 }))
    const wall: Box = { x: 0, y: 0, w: 500, h: 400 }
    const spots = packShelves(items, [wall], { x: 0, y: 0 }, 1400)
    const boxes = items.map((it) => ({ ...spots.get(it.id)!, w: it.w, h: it.h }))
    for (const b of boxes) expect(intersects(b, wall)).toBe(false)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(intersects(boxes[i], boxes[j])).toBe(false)
    }
  })
  test('freeSpot returns the point itself when free and a clear spot otherwise', () => {
    expect(freeSpot({ w: 100, h: 100 }, [], { x: 5, y: 6 })).toEqual({ x: 5, y: 6 })
    const o: Box = { x: 0, y: 0, w: 400, h: 400 }
    const p = freeSpot({ w: 100, h: 100 }, [o], { x: 100, y: 100 })
    expect(intersects({ ...p, w: 100, h: 100 }, o)).toBe(false)
    expect(freeSpot({ w: 100, h: 100 }, [o], { x: 100, y: 100 })).toEqual(p)
  })
})

describe('clustering input', () => {
  test('private and Tor tabs and non-web pages are never clusterable', () => {
    const list = [tab(1), tab(2, 'x.com', true), { id: 3, url: 'panes://settings', private: false }]
    expect(clusterable(list).map((t) => t.id)).toEqual([1])
  })
  test('tidy never puts a private tab in a topic frame, even if a group names it', () => {
    const list = [tab(1), tab(2), tab(3), tab(4, 'secret.com', true)]
    const s = tidy(emptyState('b'), list, [{ name: 'Mixed', ids: [1, 2, 3, 4] }])
    const topic = s.frames.find((f) => f.kind === 'topic')!
    expect(s.cards.filter((c) => c.frame === topic.id).map((c) => c.id)).toEqual([1, 2, 3])
    const p = s.cards.find((c) => c.id === 4)!
    expect(p.frame).toBe(PRIVATE_ID)
    expect(p.url).toBe('')
  })
  test('host clusters group two or more tabs of a site and skip private ones', () => {
    const list = [tab(1, 'a.com'), tab(2, 'a.com'), tab(3, 'b.com'), tab(4, 'a.com', true)]
    const g = hostClusters(list)
    expect(g).toEqual([{ name: 'A', ids: [1, 2] }])
  })
})

describe('tidy', () => {
  const list = tabs(30)
  const groups = [
    { name: 'One', ids: range(1, 10) },
    { name: 'Two', ids: range(11, 18) },
    { name: 'Three', ids: range(19, 24) }
  ]
  test('lays out frames and cards without overlap, rest in Other', () => {
    const s = tidy(emptyState('b'), list, groups)
    expect(s.frames.map((f) => f.name)).toEqual(['One', 'Two', 'Three', 'Other'])
    expect(s.cards.length).toBe(30)
    expect(s.cards.filter((c) => c.frame === OTHER_ID).length).toBe(6)
    expectClean(s)
  })
  test('is deterministic', () => {
    expect(tidy(emptyState('b'), list, groups)).toEqual(tidy(emptyState('b'), list, groups))
  })
  test('unchanged clusters keep their exact positions on another tidy', () => {
    const a = tidy(emptyState('b'), list, groups)
    const b = tidy(a, list, groups)
    expect(b.frames).toEqual(a.frames)
    expect(b.cards).toEqual(a.cards)
  })
  test('a frame whose cards changed keeps its id and name; others stay put', () => {
    const a = tidy(emptyState('b'), list, groups)
    const g2 = [{ name: 'Renamed by AI', ids: range(1, 8) }, groups[1], groups[2]]
    const b = tidy(a, list, g2)
    expect(b.frames.find((f) => f.id === a.frames[0].id)?.name).toBe('One')
    expect(b.frames.find((f) => f.id === a.frames[1].id)).toEqual(a.frames[1])
    expectClean(b)
  })
  test('a frame the person moved stays at its corner when its cards change', () => {
    let a = tidy(emptyState('b'), list, groups)
    a = moveFrame(a, a.frames[0].id, 5000, 5000)
    const moved = a.frames[0]
    const b = tidy(a, list, [{ name: 'One', ids: range(1, 9) }, groups[1], groups[2]])
    const f = b.frames.find((x) => x.id === moved.id)!
    expect([f.x, f.y]).toEqual([moved.x, moved.y])
    expectClean(b)
  })
  test('hand-placed cards stay in their frame; rearrange forgets them', () => {
    let a = tidy(emptyState('b'), list, groups)
    a = dropCards(a, [25], 0, 0, { x: a.frames[0].x + 40, y: a.frames[0].y + 60 })
    expect(a.cards.find((c) => c.id === 25)?.frame).toBe(a.frames[0].id)
    const b = tidy(a, list, groups)
    expect(b.cards.find((c) => c.id === 25)?.frame).toBe(a.frames[0].id)
    const c = tidy(b, list, groups, true)
    expect(c.cards.find((x) => x.id === 25)?.frame).toBe(OTHER_ID)
    expectClean(b)
    expectClean(c)
  })
  test('notes stay and frames keep clear of them', () => {
    const a = addNote(emptyState('b'), { x: 100, y: 100 }).state
    const s = tidy(a, list, groups, true)
    expect(s.notes.length).toBe(1)
    expectClean(s)
  })
  test('150 tabs in 12 clusters pack without overlap', () => {
    const many = tabs(150)
    const gs = Array.from({ length: 12 }, (_, i) => ({
      name: `G${i}`,
      ids: range(i * 11 + 1, i * 11 + 11)
    }))
    expectClean(tidy(emptyState('b'), many, gs))
  })
})

describe('syncTabs / moveToFrame', () => {
  test('new tabs land in Other, closed ones vanish, empty Other is dropped', () => {
    const a = tidy(emptyState('b'), tabs(4), [{ name: 'T', ids: [1, 2, 3] }])
    const { state, added } = syncTabs(a, [...tabs(4), tab(9)])
    expect(added).toEqual([9])
    expect(state.cards.find((c) => c.id === 9)?.frame).toBe(OTHER_ID)
    expectClean(state)
    const moved = moveToFrame(state, 9, a.frames[0].id)
    expect(moved.cards.find((c) => c.id === 9)?.frame).toBe(a.frames[0].id)
    expectClean(moved)
    const closed = syncTabs(moved, tabs(3)).state
    expect(closed.cards.some((c) => c.id === 4 || c.id === 9)).toBe(false)
  })
  test('a private tab goes to the Private frame and cannot be moved to a topic frame', () => {
    const a = tidy(emptyState('b'), tabs(3), [{ name: 'T', ids: [1, 2, 3] }])
    const { state } = syncTabs(a, [...tabs(3), tab(7, 'p.com', true)])
    expect(state.cards.find((c) => c.id === 7)?.frame).toBe(PRIVATE_ID)
    expect(moveToFrame(state, 7, a.frames[0].id)).toBe(state)
    expect(moveToFrame(state, 1, PRIVATE_ID)).toBe(state)
    const dropped = dropCards(state, [1], 0, 0, {
      x: state.frames.find((f) => f.id === PRIVATE_ID)!.x + 50,
      y: state.frames.find((f) => f.id === PRIVATE_ID)!.y + 80
    })
    expect(dropped.cards.find((c) => c.id === 1)?.frame).toBe(a.frames[0].id)
  })
  test('many new tabs grow Other and never overlap', () => {
    let s = tidy(emptyState('b'), tabs(8), [{ name: 'T', ids: range(1, 5) }])
    s = syncTabs(s, tabs(40)).state
    expectClean(s)
    // taking cards one by one widens the frame rather than stacking one tall column
    const other = s.frames.find((f) => f.id === OTHER_ID)!
    expect(other.w).toBeGreaterThan(other.h / 3)
  })
})

describe('editing', () => {
  const base = tidy(emptyState('b'), tabs(12), [
    { name: 'A', ids: range(1, 5) },
    { name: 'B', ids: range(6, 10) }
  ])
  test('dropping on empty board leaves a card loose and clear of everything', () => {
    const b = boundsOf(base.frames)!
    const s = dropCards(base, [1], 0, 0, { x: b.x + b.w + 900, y: b.y })
    const c = s.cards.find((x) => x.id === 1)!
    expect(c.frame).toBe(null)
    expect(c.manual).toBe(true)
    expectClean(s)
  })
  test('dropping on a frame snaps into its slots, growing it, without overlap', () => {
    const f = base.frames[1]
    const s = dropCards(base, [1, 2, 3], 0, 0, { x: f.x + 30, y: f.y + 70 })
    expect(s.cards.filter((c) => c.frame === f.id).length).toBe(8)
    expectClean(s)
  })
  test('dropping a card back on its own spot leaves it there', () => {
    const f = base.frames[0]
    const c = base.cards.find((x) => x.id === 2)!
    const s = dropCards(base, [2], 3, -2, { x: f.x + 100, y: f.y + 100 })
    const d = s.cards.find((x) => x.id === 2)!
    expect([d.x, d.y]).toEqual([c.x, c.y])
  })
  test('moving a frame moves its cards and never lands on another frame', () => {
    const a = base.frames[0]
    const b = base.frames[1]
    const s = moveFrame(base, a.id, b.x - a.x, b.y - a.y)
    expectClean(s)
    expect(s.frames.find((f) => f.id === a.id)?.pinned).toBe(true)
  })
  test('rename trims, caps and pins; empty is refused', () => {
    const id = base.frames[0].id
    const s = renameFrame(base, id, '  Trip   to Tokyo  ')
    expect(s.frames[0].name).toBe('Trip to Tokyo')
    expect(s.frames[0].pinned).toBe(true)
    expect(renameFrame(base, id, '   ')).toBe(base)
    expect(renameFrame(base, id, 'x'.repeat(100)).frames[0].name.length).toBe(40)
  })
  test('a drawn frame takes loose cards inside it and keeps off others', () => {
    let s = dropCards(base, [1], 0, 0, { x: 4000, y: 4000 })
    const c = s.cards.find((x) => x.id === 1)!
    const r = addFrame(s, { x: c.x - 30, y: c.y - 60, w: 400, h: 300 }, 'Mine')
    s = r.state
    expect(s.cards.find((x) => x.id === 1)?.frame).toBe(r.id)
    expectClean(s)
    const on = addFrame(s, { ...base.frames[0], w: 300, h: 300 }).state
    expectClean(on)
  })
  test('deleting a frame frees its cards for the next tidy', () => {
    const s = deleteFrame(base, base.frames[0].id)
    expect(s.cards.find((c) => c.id === 1)?.frame).toBe(null)
    expect(s.cards.find((c) => c.id === 1)?.manual).toBe(false)
  })
  test('frameAt picks the frame under a point', () => {
    const f = base.frames[1]
    expect(frameAt(base, f.x + 5, f.y + 5)?.id).toBe(f.id)
    expect(frameAt(base, -9999, -9999)).toBe(null)
  })
})

describe('assignByCentroid', () => {
  const v = (...n: number[]): number[] => n
  test('picks the nearest centroid above the threshold, else null', () => {
    const frames = [
      { id: 'a', vectors: [v(1, 0, 0), v(0.9, 0.1, 0)] },
      { id: 'b', vectors: [v(0, 1, 0)] }
    ]
    expect(assignByCentroid(v(0.95, 0.05, 0), frames, 0.5)).toBe('a')
    expect(assignByCentroid(v(0.1, 0.9, 0), frames, 0.5)).toBe('b')
    expect(assignByCentroid(v(0, 0, 1), frames, 0.5)).toBe(null)
    expect(assignByCentroid(v(1, 0, 0), [], 0.5)).toBe(null)
  })
})

describe('navigation and view', () => {
  const boxes = [
    { id: 1, x: 0, y: 0, w: CARD_W, h: CARD_H },
    { id: 2, x: 300, y: 0, w: CARD_W, h: CARD_H },
    { id: 3, x: 0, y: 300, w: CARD_W, h: CARD_H }
  ]
  test('arrows pick the card in that direction', () => {
    expect(nearestCard(boxes, 1, 'right')).toBe(2)
    expect(nearestCard(boxes, 1, 'down')).toBe(3)
    expect(nearestCard(boxes, 1, 'left')).toBe(null)
    expect(nearestCard(boxes, 3, 'up')).toBe(1)
  })
  test('fitView centres the box and caps the zoom', () => {
    const v = fitView({ x: 0, y: 0, w: 400, h: 200 }, 1000, 800, 50, 1)
    expect(v.k).toBe(1)
    expect(v.x + 200 * v.k).toBeCloseTo(500)
    expect(fitView({ x: 0, y: 0, w: 4000, h: 200 }, 1000, 800, 0).k).toBeCloseTo(0.25)
  })
})

describe('saving', () => {
  test('forDisk drops every private card and the Private frame', () => {
    const s = tidy(
      emptyState('b'),
      [tab(1), tab(2), tab(3, 'p.com', true)],
      [{ name: 'T', ids: [1, 2] }]
    )
    const d = forDisk(s)
    expect(d.cards.some((c) => c.private)).toBe(false)
    expect(d.frames.some((f) => f.kind === 'private')).toBe(false)
    expect(JSON.stringify(d)).not.toContain('p.com')
  })
  test('same run matches by id, a later run by address', () => {
    const s = tidy(emptyState('b1'), tabs(4), [{ name: 'T', ids: [1, 2, 3, 4] }])
    const same = reconcileSaved(s, tabs(4), 'b1')
    expect(same.cards.map((c) => c.id)).toEqual([1, 2, 3, 4])
    // after a restart the tabs have new ids but the same addresses
    const later = reconcileSaved(
      s,
      [10, 11, 12, 13].map((id, i) => ({ id, url: tab(i + 1).url, private: false })),
      'b2'
    )
    expect(later.cards.map((c) => c.id)).toEqual([10, 11, 12, 13])
    expect(later.cards.map((c) => [c.x, c.y])).toEqual(s.cards.map((c) => [c.x, c.y]))
    expect(later.boot).toBe('b2')
  })
  test('a card is about one tab: duplicates of an address are claimed once each', () => {
    const dup = [tab(1, 'same.com'), tab(2, 'same.com')].map((t) => ({
      ...t,
      url: 'https://same.com/'
    }))
    const s = tidy(emptyState('b1'), dup, [{ name: 'T', ids: [1, 2] }])
    const later = reconcileSaved(
      s,
      [
        { ...dup[0], id: 8 },
        { ...dup[1], id: 9 }
      ],
      'b2'
    )
    expect(new Set(later.cards.map((c) => c.id)).size).toBe(2)
    expect(CARD_H).toBeGreaterThan(0)
  })
})
