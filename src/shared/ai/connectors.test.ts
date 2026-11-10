import { describe, expect, test } from 'bun:test'
import {
  addNote,
  CARD_H,
  CARD_W,
  deleteNote,
  emptyState,
  forDisk,
  moveFrame,
  reconcileSaved,
  syncTabs,
  tidy,
  type CanvasState,
  type TabLite
} from './canvas'
import {
  addConnector,
  anchorOn,
  attachEnds,
  bezierAt,
  connectorsOf,
  curveControls,
  deleteConnectors,
  EDGE_GAP,
  elbowPoints,
  endBox,
  objectAt,
  patchConnector,
  polylineMid,
  pruneConnectors,
  remapCards,
  routeAll,
  routeBetween,
  routeConnector,
  sanitizeConnectors,
  setConnectorEnd,
  sideFacing,
  type CanvasConnector,
  type End
} from './connectors'

const tab = (id: number, priv = false): TabLite => ({
  id,
  url: `https://site${id}.com/p${id}`,
  private: priv
})
const card = (id: number): End => ({ kind: 'card', id })
const point = (x: number, y: number): End => ({ kind: 'point', x, y })

/** Two loose tabs side by side: card 1 at (0,0), card 2 at (600,0). */
function board(): CanvasState {
  const s = syncTabs(emptyState('b'), [tab(1), tab(2)]).state
  return {
    ...s,
    cards: s.cards.map((c) =>
      c.id === 1 ? { ...c, x: 0, y: 0, frame: null } : { ...c, x: 600, y: 0, frame: null }
    )
  }
}

describe('anchors', () => {
  const box = { x: 0, y: 0, w: 240, h: 300 }
  test('the side facing a point, measured against the box proportions', () => {
    expect(sideFacing(box, { x: 900, y: 150 })).toBe('right')
    expect(sideFacing(box, { x: -400, y: 200 })).toBe('left')
    expect(sideFacing(box, { x: 120, y: 900 })).toBe('bottom')
    expect(sideFacing(box, { x: 130, y: -500 })).toBe('top')
    // to the right and a bit down: still sideways for a tall card
    expect(sideFacing(box, { x: 400, y: 330 })).toBe('right')
  })
  test('an anchor is the middle of the side, just outside the edge', () => {
    expect(anchorOn(box, 'right')).toEqual({ x: 240 + EDGE_GAP, y: 150 })
    expect(anchorOn(box, 'top')).toEqual({ x: 120, y: -EDGE_GAP })
    expect(anchorOn(box, 'bottom', 0)).toEqual({ x: 120, y: 300 })
  })
  test('two boxes open the sides that face each other', () => {
    const [a, b] = attachEnds(box, { x: 600, y: 0, w: 240, h: 300 })
    expect(a.side).toBe('right')
    expect(b.side).toBe('left')
    expect(a.n).toEqual({ x: 1, y: 0 })
    expect(b.n).toEqual({ x: -1, y: 0 })
  })
  test('a free point attaches where it is and leaves toward the other end', () => {
    const [a, b] = attachEnds(box, { x: 120, y: 800 })
    expect(a.side).toBe('bottom')
    expect(b.side).toBeNull()
    expect(b.p).toEqual({ x: 120, y: 800 })
    expect(b.n.y).toBeLessThan(0)
  })
})

describe('routes', () => {
  const [a, b] = attachEnds({ x: 0, y: 0, w: 240, h: 300 }, { x: 600, y: 200, w: 240, h: 300 })
  test('curve controls leave each end straight out of its side', () => {
    const [c1, c2] = curveControls(a, b)
    expect(c1.y).toBe(a.p.y)
    expect(c1.x).toBeGreaterThan(a.p.x)
    expect(c2.y).toBe(b.p.y)
    expect(c2.x).toBeLessThan(b.p.x)
  })
  test('two cards facing each other across a small gap: the bend stays inside the gap (no loop)', () => {
    const [p, q] = attachEnds({ x: 0, y: 0, w: 240, h: 300 }, { x: 0, y: 316, w: 240, h: 300 })
    const [c1, c2] = curveControls(p, q)
    // the first control is not past the second end, nor the second past the first
    expect(c1.y).toBeLessThanOrEqual(q.p.y)
    expect(c2.y).toBeGreaterThanOrEqual(p.p.y)
    expect(c1.y).toBeLessThanOrEqual(c2.y)
  })
  test('the label of a straight line sits at its middle', () => {
    const r = routeBetween(a, b, 'straight', 'end')
    expect(r.mid.x).toBeCloseTo((a.p.x + b.p.x) / 2)
    expect(r.mid.y).toBeCloseTo((a.p.y + b.p.y) / 2)
  })
  test('the label of a curve sits at t = 0.5', () => {
    const [c1, c2] = curveControls(a, b)
    const r = routeBetween(a, b, 'curved', 'none')
    expect(r.mid).toEqual(bezierAt(a.p, c1, c2, b.p, 0.5))
    expect(r.d.startsWith('M')).toBe(true)
    expect(r.d).toContain('C')
  })
  test('arrowheads: none, at the end, at both ends', () => {
    expect(routeBetween(a, b, 'curved', 'none').heads.length).toBe(0)
    expect(routeBetween(a, b, 'curved', 'end').heads.length).toBe(1)
    expect(routeBetween(a, b, 'elbow', 'both').heads.length).toBe(2)
  })
  test('an arrowhead tip is the end point; the line stops short of it', () => {
    const r = routeBetween(a, b, 'straight', 'end')
    const tip = r.heads[0].match(/^M(-?[\d.]+) (-?[\d.]+)/)!
    expect(Number(tip[1])).toBeCloseTo(b.p.x, 0)
    expect(Number(tip[2])).toBeCloseTo(b.p.y, 0)
    const end = r.d.match(/L(-?[\d.]+) (-?[\d.]+)$/)!
    expect(Number(end[1])).toBeLessThan(b.p.x)
  })
  test('elbows turn at right angles only and drop corners that are not', () => {
    const pts = elbowPoints(a, b)
    expect(pts.length).toBe(4)
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true)
    }
    const [p, q] = attachEnds({ x: 0, y: 0, w: 100, h: 100 }, { x: 400, y: 0, w: 100, h: 100 })
    expect(elbowPoints(p, q).length).toBe(2)
  })
  test('the middle of a polyline is halfway along it', () => {
    expect(
      polylineMid([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 }
      ])
    ).toEqual({ x: 10, y: 0 })
  })
})

describe('connectors on the board', () => {
  test('add, style, label, reattach, delete', () => {
    const s0 = board()
    const r = addConnector(s0, card(1), card(2))!
    expect(r.id).toBe(`k${s0.seq + 1}`)
    expect(r.state.seq).toBe(s0.seq + 1)
    let s = r.state
    expect(connectorsOf(s)[0]).toMatchObject({ shape: 'curved', heads: 'end', label: '' })
    s = patchConnector(s, r.id, { shape: 'elbow', heads: 'both', label: '  depends   on  ' })
    expect(connectorsOf(s)[0]).toMatchObject({ shape: 'elbow', heads: 'both', label: 'depends on' })
    expect(patchConnector(s, r.id, { shape: 'elbow' })).toBe(s)
    s = setConnectorEnd(s, r.id, 'to', point(100, 900))
    expect(connectorsOf(s)[0].to).toEqual(point(100, 900))
    // never onto the object at its other end
    expect(setConnectorEnd(s, r.id, 'to', card(1))).toBe(s)
    expect(connectorsOf(deleteConnectors(s, [r.id]))).toEqual([])
  })
  test('routeAll: lines meeting on one side fan out along it, in the order of where they go', () => {
    const s0 = syncTabs(emptyState('b'), [tab(1), tab(2), tab(3)]).state
    const at = [
      [0, 0],
      [600, -400],
      [600, 400]
    ]
    let s: CanvasState = {
      ...s0,
      cards: s0.cards.map((c, i) => ({ ...c, x: at[i][0], y: at[i][1], frame: null }))
    }
    s = addConnector(s, card(1), card(3), { shape: 'elbow' })!.state
    s = addConnector(s, card(1), card(2), { shape: 'elbow' })!.state
    const list = connectorsOf(s)
    const [low, high] = routeAll(s, list)
    // both leave card 1's right side, one above the other: the line going up starts higher
    expect(high!.a.x).toBe(low!.a.x)
    expect(high!.a.y).toBeLessThan(low!.a.y)
    // a lone line still starts mid-side
    const one = routeAll(s, [list[0]])[0]!
    expect(one.a.y).toBeCloseTo(150, 0)
  })
  test('routeAll: an elbow line goes through the gap beside a card rather than through it', () => {
    const s0 = syncTabs(emptyState('b'), [tab(1), tab(2), tab(3)]).state
    const pos = [
      [0, 0],
      [700, 400],
      [290, 200] // in the way of a line halfway between 1 and 2
    ]
    let s: CanvasState = {
      ...s0,
      cards: s0.cards.map((c, i) => ({ ...c, x: pos[i][0], y: pos[i][1], frame: null }))
    }
    s = addConnector(s, card(1), card(2), { shape: 'elbow' })!.state
    const r = routeAll(s, connectorsOf(s))[0]!
    // halfway (x 470) would cut through card 3 (x 290 to 530): the run goes down its right side instead
    expect(r.d).toContain('540')
    expect(r.d).not.toContain('470')
  })
  test('no connector from an object to itself, to a missing one, or of zero length', () => {
    const s = board()
    expect(addConnector(s, card(1), card(1))).toBeNull()
    expect(addConnector(s, card(1), card(99))).toBeNull()
    expect(addConnector(s, point(5, 5), point(6, 6))).toBeNull()
    expect(addConnector(s, card(1), point(5, 900))).not.toBeNull()
  })
  test('a connector follows its cards when they move and when a frame moves', () => {
    const s0 = board()
    const r = addConnector(s0, card(1), card(2), { shape: 'straight' })!
    const before = routeConnector(r.state, connectorsOf(r.state)[0])!
    expect(before.a).toEqual({ x: CARD_W + EDGE_GAP, y: CARD_H / 2 })
    const moved = {
      ...r.state,
      cards: r.state.cards.map((c) => (c.id === 2 ? { ...c, y: c.y + 500 } : c))
    }
    const after = routeConnector(moved, connectorsOf(moved)[0])!
    expect(after.b.y).toBeGreaterThan(before.b.y)
    // while dragging: an offset moves the end without touching the state
    const dragged = routeConnector(
      r.state,
      connectorsOf(r.state)[0],
      new Map([['c2', { x: 0, y: 500 }]])
    )!
    expect(dragged.b).toEqual(after.b)

    const t = tidy(emptyState('b'), [tab(1), tab(2), tab(3)], [{ name: 'G', ids: [1, 2] }])
    const k = addConnector(t, card(1), card(3))!
    const f = t.frames.find((x) => x.name === 'G')!
    const r0 = routeConnector(k.state, connectorsOf(k.state)[0])!
    const m = moveFrame(k.state, f.id, 0, -2000)
    const r1 = routeConnector(m, connectorsOf(m)[0])!
    expect(r1.a.y).toBeLessThan(r0.a.y)
  })
  test('deleting an object removes its connectors; points stay put', () => {
    const n = addNote(board(), { x: 0, y: 800 })
    let s = addConnector(n.state, { kind: 'note', id: n.id }, card(2))!.state
    s = addConnector(s, card(1), point(-500, -500))!.state
    expect(pruneConnectors(s)).toBe(s)
    const gone = pruneConnectors(deleteNote(s, n.id))
    expect(connectorsOf(gone).length).toBe(1)
    expect(connectorsOf(gone)[0].to).toEqual(point(-500, -500))
    // a closed tab takes its connectors with it
    const closed = pruneConnectors(syncTabs(s, [tab(2)]).state)
    expect(connectorsOf(closed).length).toBe(1)
    expect(connectorsOf(closed)[0].from).toEqual({ kind: 'note', id: n.id })
  })
  test('objectAt: cards first, then notes, then frames (by header or edge when hovering)', () => {
    const t = tidy(emptyState('b'), [tab(1), tab(2)], [{ name: 'G', ids: [1, 2] }])
    const f = t.frames[0]
    const c = t.cards[0]
    expect(objectAt(t, { x: c.x + 10, y: c.y + 10 })).toEqual(card(c.id))
    expect(objectAt(t, { x: c.x - 4, y: c.y + 10 }, { pad: 8, skip: `c${c.id}` })).toEqual({
      kind: 'frame',
      id: f.id
    })
    // the middle of a frame between cards is a frame when dropping, nothing when hovering
    const gapX = c.x + CARD_W + 8
    expect(objectAt(t, { x: gapX, y: c.y + 100 })).toEqual({ kind: 'frame', id: f.id })
    expect(objectAt(t, { x: gapX, y: c.y + 100 }, { edgeOnly: true, pad: 4 })).toBeNull()
    expect(objectAt(t, { x: f.x + 30, y: f.y + 10 }, { edgeOnly: true, pad: 4 })).toEqual({
      kind: 'frame',
      id: f.id
    })
    expect(objectAt(t, { x: -5000, y: -5000 })).toBeNull()
    expect(endBox(t, { kind: 'frame', id: f.id })).toEqual({ x: f.x, y: f.y, w: f.w, h: f.h })
  })
})

describe('saving and loading', () => {
  test('connectors survive a save and a load in a later run, following their cards to new ids', () => {
    const n = addNote(board(), { x: 0, y: 900 })
    let s = addConnector(n.state, card(1), card(2), { shape: 'elbow', heads: 'both' })!.state
    s = patchConnector(s, connectorsOf(s)[0].id, { label: 'next' })
    s = addConnector(s, { kind: 'note', id: n.id }, point(40, 2000))!.state
    const disk = JSON.parse(JSON.stringify(forDisk(s))) as CanvasState
    expect(connectorsOf(disk).length).toBe(2)
    // later run: tab ids changed (1 -> 11, 2 -> 12), addresses did not
    const later = reconcileSaved(
      disk,
      [
        { id: 11, url: tab(1).url, private: false },
        { id: 12, url: tab(2).url, private: false }
      ],
      'b2'
    )
    const ks = connectorsOf(later)
    expect(ks.length).toBe(2)
    expect(ks[0]).toMatchObject({
      from: card(11),
      to: card(12),
      shape: 'elbow',
      heads: 'both',
      label: 'next'
    })
    expect(ks[1].from).toEqual({ kind: 'note', id: n.id })
  })
  test('a card no tab claims takes its connectors with it (its old id is not reused)', () => {
    const s = addConnector(board(), card(1), card(2))!.state
    const later = reconcileSaved(
      forDisk(s),
      [{ id: 1, url: 'https://other.com/', private: false }],
      'b2'
    )
    expect(connectorsOf(later)).toEqual([])
  })
  test('boards saved before connectors load with none', () => {
    const s = board()
    delete (s as Partial<CanvasState>).connectors
    expect(connectorsOf(reconcileSaved(s, [tab(1)], 'b'))).toEqual([])
    expect(connectorsOf(forDisk(s))).toEqual([])
  })
  test('nothing tied to a private card is written', () => {
    const s0 = syncTabs(board(), [tab(1), tab(2), tab(3, true)]).state
    const s = addConnector(s0, card(1), card(3))!.state
    expect(connectorsOf(s).length).toBe(1)
    expect(connectorsOf(forDisk(s))).toEqual([])
  })
  test('sanitize keeps well-formed connectors only', () => {
    const good: CanvasConnector = {
      id: 'k1',
      from: card(1),
      to: point(1, 2),
      shape: 'straight',
      heads: 'none',
      label: 'x'
    }
    const list = sanitizeConnectors([
      good,
      { ...good }, // the same id again
      { id: 'k2', from: card(1), to: card(1) },
      { id: 'k3', from: { kind: 'card', id: 1.5 }, to: point(0, 0) },
      { id: 'k4', from: { kind: 'note', id: '' }, to: point(0, 0) },
      { id: 'k5', from: point(Infinity, 0), to: point(0, 0) },
      { id: 'k6', from: { kind: 'frame', id: 'f1' }, to: point(0, 0), shape: 'zigzag', label: 7 },
      null,
      'x'
    ])
    expect(list.map((c) => c.id)).toEqual(['k1', 'k6'])
    expect(list[1]).toMatchObject({ shape: 'curved', heads: 'end', label: '' })
    expect(sanitizeConnectors({})).toEqual([])
    expect(sanitizeConnectors([{ ...good, label: 'a'.repeat(200) }])[0].label.length).toBe(60)
  })
  test('remapCards drops connectors whose card has no new id', () => {
    const list: CanvasConnector[] = [
      { id: 'k1', from: card(1), to: card(2), shape: 'curved', heads: 'end', label: '' },
      { id: 'k2', from: card(3), to: point(0, 0), shape: 'curved', heads: 'end', label: '' }
    ]
    const out = remapCards(list, new Map([[3, 30]]))
    expect(out.map((c) => c.id)).toEqual(['k2'])
    expect(out[0].from).toEqual(card(30))
  })
})
