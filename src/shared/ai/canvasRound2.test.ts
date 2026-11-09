import { describe, expect, test } from 'bun:test'
import {
  addFrame,
  addLoose,
  addResultFrame,
  boundsOf,
  cardBox,
  collapseFrame,
  collapseOld,
  emptyState,
  expandFrame,
  groupInto,
  intersects,
  isStack,
  setItem,
  shownCards,
  STACK_H,
  STACK_W,
  tidy,
  type CanvasState
} from './canvas'
import { itemFor } from './canvasItems'
import {
  addShape,
  addStroke,
  deleteMarks,
  duplicateMarks,
  MARK_TEXT_MAX,
  markAt,
  patchMark,
  reorderMarks,
  sanitizeMarks,
  shapePath,
  simplifyPath
} from './canvasMarks'
import {
  afterStop,
  clearQueue,
  dequeue,
  editItem,
  enqueue,
  QUEUE_MAX,
  removeItem,
  reorder
} from './canvasQueue'
import {
  applyBoardTool,
  boardSummary,
  checkBoardCall,
  boardToolsFor,
  parseRef,
  refToken
} from './canvasTools'

const tabs = (n: number): Array<{ id: number; url: string; title: string; private: boolean }> =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    url: `https://s${i}.com/p`,
    title: `Page ${i + 1}`,
    private: false
  }))
const lite = (n: number): Array<{ id: number; url: string; private: boolean }> =>
  tabs(n).map((t) => ({ id: t.id, url: t.url, private: false }))
const board = (n = 8): CanvasState =>
  tidy(emptyState('b'), lite(n), [
    { name: 'A', ids: [1, 2, 3, 4] },
    { name: 'B', ids: [5, 6, 7, 8] }
  ])
const view = { x: 0, y: 0 }

describe('queue', () => {
  test('enqueue trims, ignores empty, caps', () => {
    expect(enqueue([], '  hi   there ', 'a')).toEqual([{ id: 'a', text: 'hi there' }])
    expect(enqueue([], '   ', 'a')).toEqual([])
    let q = [] as ReturnType<typeof enqueue>
    for (let i = 0; i < QUEUE_MAX + 3; i++) q = enqueue(q, `m${i}`, `i${i}`)
    expect(q.length).toBe(QUEUE_MAX)
  })
  test('dequeue runs in order and does not change the input', () => {
    const q = enqueue(enqueue([], 'one', 'a'), 'two', 'b')
    const d = dequeue(q)
    expect(d.next?.text).toBe('one')
    expect(d.rest.map((i) => i.id)).toEqual(['b'])
    expect(q.length).toBe(2)
    expect(dequeue([])).toEqual({ next: null, rest: [] })
  })
  test('edit, remove, reorder', () => {
    const q = ['a', 'b', 'c'].reduce(
      (acc, id) => enqueue(acc, `text ${id}`, id),
      [] as ReturnType<typeof enqueue>
    )
    expect(editItem(q, 'b', 'changed')[1].text).toBe('changed')
    expect(editItem(q, 'b', '  ').map((i) => i.id)).toEqual(['a', 'c'])
    expect(editItem(q, 'zz', 'x')).toEqual(q)
    expect(removeItem(q, 'a').map((i) => i.id)).toEqual(['b', 'c'])
    expect(reorder(q, 'c', 0).map((i) => i.id)).toEqual(['c', 'a', 'b'])
    expect(reorder(q, 'a', 99).map((i) => i.id)).toEqual(['b', 'c', 'a'])
    expect(reorder(q, 'nope', 0)).toEqual(q)
  })
  test('stop cancels only the running turn: the queue goes on; clear drops the rest', () => {
    const q = enqueue(enqueue([], 'one', 'a'), 'two', 'b')
    expect(afterStop(q).next?.id).toBe('a')
    expect(afterStop(q).rest.length).toBe(1)
    expect(clearQueue()).toEqual([])
  })
})

describe('marks', () => {
  const s0 = emptyState('b')
  test('simplify keeps the ends and the corners', () => {
    const line = [0, 0, 5, 0.2, 10, 0, 15, 0.1, 20, 0, 20, 10, 20, 20]
    const out = simplifyPath(line, 1)
    expect(out.slice(0, 2)).toEqual([0, 0])
    expect(out.slice(-2)).toEqual([20, 20])
    expect(out.length).toBeLessThan(line.length)
    expect(out.slice(2, 4)).toEqual([20, 0])
  })
  test('strokes: too short is nothing, long ones are kept and bounded', () => {
    expect(addStroke(s0, 'pen', [0, 0, 1, 1])).toBeNull()
    const r = addStroke(s0, 'pen', [0, 0, 50, 5, 100, 0])!
    expect(r.state.marks!.length).toBe(1)
    expect(r.state.marks![0].w).toBe(100)
  })
  test('shapes: size floor, square, text label, reverse drag', () => {
    expect(addShape(s0, 'rect', { x: 0, y: 0 }, { x: 5, y: 5 })).toBeNull()
    const sq = addShape(s0, 'ellipse', { x: 100, y: 100 }, { x: 40, y: 70 }, { square: true })!
    expect(sq.state.marks![0]).toMatchObject({ x: 40, y: 40, w: 60, h: 60 })
    const t = addShape(s0, 'text', { x: 5, y: 6 }, { x: 5, y: 6 }, { text: 'hello' })!
    expect(t.state.marks![0]).toMatchObject({ kind: 'text', text: 'hello' })
  })
  test('patch keeps colours in range, moves a line with its points, rotates', () => {
    const l = addStroke(s0, 'marker', [0, 0, 50, 0, 100, 10])!
    const moved = patchMark(l.state, l.id, { x: 10, y: 20 })
    expect(moved.marks![0].pts![0]).toBe(10)
    expect(moved.marks![0].pts![1]).toBe(20)
    const sh = addShape(s0, 'rect', { x: 0, y: 0 }, { x: 50, y: 50 })!
    const p = patchMark(sh.state, sh.id, {
      color: 19,
      fill: -5,
      rot: -90,
      text: 'x'.repeat(MARK_TEXT_MAX + 500)
    })
    expect(p.marks![0].color).toBe(3)
    expect(p.marks![0].fill).toBe(-1)
    expect(p.marks![0].rot).toBe(270)
    expect(p.marks![0].text!.length).toBe(MARK_TEXT_MAX)
  })
  test('layer order, duplicate, delete', () => {
    let s = s0
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = addShape(s, 'rect', { x: i * 100, y: 0 }, { x: i * 100 + 50, y: 50 })!
      s = r.state
      ids.push(r.id)
    }
    expect(reorderMarks(s, [ids[0]], 'front').marks!.map((m) => m.id)).toEqual([
      ids[1],
      ids[2],
      ids[0]
    ])
    expect(reorderMarks(s, [ids[2]], 'back').marks!.map((m) => m.id)).toEqual([
      ids[2],
      ids[0],
      ids[1]
    ])
    const d = duplicateMarks(s, [ids[0]])
    expect(d.state.marks!.length).toBe(4)
    expect(d.state.marks![3].x).toBe(24)
    expect(deleteMarks(d.state, d.ids).marks!.length).toBe(3)
    expect(deleteMarks(s, ['nope'])).toBe(s)
  })
  test('hit testing: lines, rotated shapes, ellipse corners', () => {
    const l = addStroke(s0, 'pen', [0, 0, 100, 0])!
    expect(markAt(l.state, 50, 3)?.id).toBe(l.id)
    expect(markAt(l.state, 50, 30)).toBeNull()
    const e = addShape(s0, 'ellipse', { x: 0, y: 0 }, { x: 100, y: 100 })!
    expect(markAt(e.state, 50, 50)).not.toBeNull()
    expect(markAt(e.state, 2, 2, 0)).toBeNull()
    const r = addShape(s0, 'rect', { x: 0, y: 0 }, { x: 200, y: 20 })!
    const turned = patchMark(r.state, r.id, { rot: 90 })
    expect(markAt(turned, 100, 90, 0)).not.toBeNull()
    expect(markAt(turned, 20, 10, 0)).toBeNull()
  })
  test('paths exist for the drawn shapes and nothing for plain ones', () => {
    for (const k of ['diamond', 'triangle', 'star', 'bubble'] as const)
      expect(shapePath(k, 100, 60).startsWith('M')).toBe(true)
    expect(shapePath('rect', 100, 60)).toBe('')
  })
  test('sanitize drops junk and clamps', () => {
    const out = sanitizeMarks([
      { id: 'm1', kind: 'rect', x: 1, y: 2, w: 3, h: 4, color: 99, fill: 2 },
      { id: 'm2', kind: 'pen', x: 0, y: 0, w: 1, h: 1, pts: [0, 0, 1] },
      { id: 'm3', kind: 'nope', x: 0, y: 0, w: 1, h: 1 },
      { id: 'm4', kind: 'pen', x: 0, y: 0, w: 1, h: 1, pts: [0, 0, 5, 5, 9, 9] },
      { kind: 'rect', x: 0, y: 0, w: 1, h: 1 },
      { id: 'm5', kind: 'text', x: 0, y: 0, w: 5, h: 5, text: 7 }
    ])
    expect(out.map((m) => m.id)).toEqual(['m1', 'm4', 'm5'])
    expect(out[0].color).toBe(3)
    expect(sanitizeMarks('x')).toEqual([])
  })
})

describe('stacks', () => {
  const make = (n: number): CanvasState => {
    let s = board()
    for (let i = 0; i < n; i++) {
      const r = addResultFrame(s, `q${i}`, 3, { x: 0, y: 0 })
      s = r.state
      r.ids.forEach((id, k) => (s = setItem(s, id, itemFor(`https://r.com/${i}/${k}`, 'R'))))
    }
    return s
  }
  const results = (s: CanvasState): CanvasState['frames'] =>
    s.frames.filter((f) => f.kind === 'result')
  test('the latest two stay open, older fold', () => {
    const s = collapseOld(make(4))
    const r = results(s)
    expect(r.map((f) => isStack(f))).toEqual([true, true, false, false])
    expect(r[0]).toMatchObject({ w: STACK_W, h: STACK_H })
  })
  test('folded cards are not shown; opening restores size, avoids overlap and sticks open', () => {
    let s = collapseOld(make(4))
    const first = results(s)[0]
    expect(shownCards(s).length).toBe(s.cards.length - 3 * 2)
    s = expandFrame(s, first.id)
    const f = s.frames.find((x) => x.id === first.id)!
    expect(isStack(f)).toBe(false)
    expect(f.fan).toBe(true)
    expect(collapseOld(s).frames.find((x) => x.id === first.id)!.stack).toBeUndefined()
    const boxes = s.frames.filter((x) => !isStack(x))
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(intersects(boxes[i], boxes[j])).toBe(false)
  })
  test('only results fold, once; tidy leaves a stack as it is', () => {
    const s0 = make(3)
    const topic = s0.frames.find((f) => f.kind === 'topic')!
    expect(collapseFrame(s0, topic.id)).toBe(s0)
    const s = collapseOld(s0)
    expect(collapseFrame(s, results(s)[0].id)).toBe(s)
    const t = tidy(s, lite(8), [{ name: 'A', ids: [1, 2, 3, 4] }], true)
    expect(t.frames.find((f) => f.id === results(s)[0].id)).toEqual(results(s)[0])
  })
})

describe('free space', () => {
  test('a loose card lands beside its sources and never on anything', () => {
    const s = board()
    const src = s.cards[0]
    const r = addLoose(s, itemFor('https://a.com/x', 'X'), { cards: [src.id] })
    const c = r.state.cards.find((x) => x.id === r.id)!
    expect(c.frame).toBeNull()
    expect(r.id).toBeLessThan(0)
    for (const f of r.state.frames) expect(intersects(cardBox(c), f)).toBe(false)
    for (const o of r.state.cards.filter((x) => x.id !== r.id))
      expect(intersects(cardBox(c), cardBox(o))).toBe(false)
  })
  test('many loose cards in a row never overlap', () => {
    let s = board()
    for (let i = 0; i < 12; i++)
      s = addLoose(s, itemFor(`https://a.com/${i}`, 'X'), { cards: [s.cards[0].id] }).state
    const l = s.cards.filter((c) => !c.frame)
    for (let i = 0; i < l.length; i++)
      for (let j = i + 1; j < l.length; j++)
        expect(intersects(cardBox(l[i]), cardBox(l[j]))).toBe(false)
  })
  test('groupInto makes a named frame, skips private cards, null for nothing', () => {
    const s = board()
    const r = groupInto(s, '  Research  ', [1, 2, 99])!
    expect(r.state.frames.find((f) => f.id === r.frameId)?.name).toBe('Research')
    expect(
      r.state.cards
        .filter((c) => c.frame === r.frameId)
        .map((c) => c.id)
        .sort()
    ).toEqual([1, 2])
    expect(groupInto(s, 'x', [99])).toBeNull()
    expect(boundsOf(r.state.frames)).not.toBeNull()
  })
  test('adding a frame does not disturb others', () => {
    const s = board()
    expect(addFrame(s, { x: 0, y: 0, w: 300, h: 300 }).state.frames.length).toBe(
      s.frames.length + 1
    )
  })
})

describe('board tools', () => {
  test('tokens round trip', () => {
    expect(refToken({ kind: 'card', id: 12 })).toBe('c12')
    expect(refToken({ kind: 'card', id: -3 })).toBe('v3')
    expect(parseRef('c12')).toEqual({ kind: 'card', id: 12 })
    expect(parseRef('v3')).toEqual({ kind: 'card', id: -3 })
    expect(parseRef('f2')).toEqual({ kind: 'frame', id: 'f2' })
    expect(parseRef('x1')).toBeNull()
    expect(parseRef(7)).toBeNull()
  })
  test('the small model gets fewer tools', () => {
    const weak = boardToolsFor(true).map((t) => t.name)
    expect(weak).toContain('get_board')
    expect(weak).not.toContain('delete_items')
    expect(boardToolsFor(false).length).toBeGreaterThan(weak.length)
    expect(boardToolsFor(false).find((t) => t.name === 'delete_items')?.confirm).toBe(true)
  })
  test('arguments are checked', () => {
    expect(checkBoardCall('create_frame', { name: 'R', cardIds: ['c1', 'c2'] }).ok).toBe(true)
    expect(checkBoardCall('create_frame', { name: '', cardIds: ['c1'] }).ok).toBe(false)
    expect(checkBoardCall('create_frame', { name: 'R', cardIds: ['nope'] }).ok).toBe(false)
    expect(checkBoardCall('arrange', { by: 'weird' }).ok).toBe(false)
    expect(checkBoardCall('arrange', { by: 'custom', groups: [] }).ok).toBe(false)
    expect(checkBoardCall('add_card', { url: 'javascript:alert(1)' }).ok).toBe(false)
    expect(checkBoardCall('add_note', { text: '   ' }).ok).toBe(false)
    expect(
      checkBoardCall('connect', { fromId: 'c1', toId: 'c2', label: 'x'.repeat(200) })
    ).toMatchObject({ ok: true })
    expect(checkBoardCall('set_kind', { cardId: 'f1', kind: 'note' }).ok).toBe(false)
    expect(checkBoardCall('add_shape', { kind: 'blob' }).ok).toBe(false)
    expect(checkBoardCall('tidy_up', {})).toMatchObject({ ok: true, value: { scope: 'keep' } })
    expect(checkBoardCall('nope', {}).ok).toBe(false)
    expect(checkBoardCall('select', { ids: Array.from({ length: 200 }, () => 'c1') }).ok).toBe(
      false
    )
  })
  test('the summary names frames and cards, hides private tabs, and is capped', () => {
    const s = board()
    const t = [...tabs(8)]
    t[1] = { ...t[1], private: true }
    const text = boardSummary(s, t, ['c1'])
    expect(text).toContain('Frame')
    expect(text).toContain('"Page 1"')
    expect(text).toContain('Selected: c1')
    expect(text).not.toContain('"Page 2"')
    expect(boardSummary(s, t, [], 100).length).toBeLessThan(130)
  })
  test('create_frame and arrange by kind are one new state each', () => {
    const s = board()
    const c = checkBoardCall('create_frame', { name: 'Research', cardIds: ['c1', 'c2'] })
    if (!c.ok) throw new Error('bad')
    const r = applyBoardTool(s, c.value, tabs(8), view)
    expect(r.state.frames.some((f) => f.name === 'Research')).toBe(true)
    expect(r.said).toContain('Research')
    expect(s.frames.some((f) => f.name === 'Research')).toBe(false)
    const k = checkBoardCall('arrange', { by: 'kind' })
    if (!k.ok) throw new Error('bad')
    const a = applyBoardTool(s, k.value, tabs(8), view)
    expect(a.state.frames.some((f) => f.name === 'Pages')).toBe(true)
  })
  test('delete asks first and never closes tabs; virtual cards go', () => {
    const s0 = board()
    const a = addLoose(s0, itemFor('https://a.com/x', 'X'))
    const c = checkBoardCall('delete_items', { ids: ['c1', refToken({ kind: 'card', id: a.id })] })
    if (!c.ok) throw new Error('bad')
    const r = applyBoardTool(a.state, c.value, tabs(8), view)
    expect(r.confirm).toBeDefined()
    expect(r.state.cards.some((x) => x.id === a.id)).toBe(false)
    expect(r.state.cards.some((x) => x.id === 1)).toBe(true)
    expect(r.result).toContain('stay')
  })
  test('notes, cards and shapes land in free space; connect and set_kind work; errors say why', () => {
    let s = board()
    const run = (name: string, input: unknown): ReturnType<typeof applyBoardTool> => {
      const c = checkBoardCall(name, input)
      if (!c.ok) throw new Error(c.error)
      const r = applyBoardTool(s, c.value, tabs(8), view)
      s = r.state
      return r
    }
    run('add_note', { text: 'Hotel is near the station', near: 'c1' })
    const note = s.cards.find((c) => c.id < 0)!
    expect(s.items[String(note.id)]).toMatchObject({ kind: 'answer', placement: 'note' })
    run('add_card', { url: 'https://booking.example/room', near: 'c2' })
    const card = s.cards.filter((c) => c.id < 0)[1]
    run('connect', {
      fromId: refToken({ kind: 'card', id: note.id }),
      toId: refToken({ kind: 'card', id: card.id }),
      label: 'book'
    })
    expect(s.connectors!.length).toBe(1)
    expect(s.connectors![0].label).toBe('book')
    run('set_kind', { cardId: refToken({ kind: 'card', id: card.id }), kind: 'note' })
    expect(s.items[String(card.id)].placement).toBe('note')
    const shape = run('add_shape', { kind: 'diamond', text: 'Decide', near: 'c3' })
    expect(shape.said).toBe('Drew a shape')
    const m = s.marks![0]
    run('style', { ids: [m.id], color: 2, fill: 5 })
    expect(s.marks![0]).toMatchObject({ color: 2, fill: 5 })
    const loose = s.cards.filter((c) => !c.frame)
    for (let i = 0; i < loose.length; i++)
      for (let j = i + 1; j < loose.length; j++)
        expect(intersects(cardBox(loose[i]), cardBox(loose[j]))).toBe(false)
    const bad = applyBoardTool(s, { name: 'set_kind', card: 1, kind: 'note' }, tabs(8), view)
    expect(bad.result.startsWith('Error')).toBe(true)
    expect(bad.state).toBe(s)
  })
  test('tidy and arrange by topic are left to the renderer; focus and select too', () => {
    const s = board()
    expect(applyBoardTool(s, { name: 'tidy_up', scope: 'all' }, tabs(8), view).effect).toEqual({
      kind: 'tidy',
      all: true
    })
    expect(
      applyBoardTool(s, { name: 'arrange', by: 'topic', groups: [] }, tabs(8), view).effect
    ).toEqual({ kind: 'arrange', by: 'topic' })
    expect(
      applyBoardTool(s, { name: 'focus', ids: [{ kind: 'card', id: 1 }] }, tabs(8), view).effect
        ?.kind
    ).toBe('focus')
  })
})

import { exampleAsks, splitBlocks } from './canvasPlace'
import { boardStatus } from './canvasTools'

describe('dock helpers', () => {
  test('answers split into parts, fences and lists stay whole', () => {
    const t =
      'First para.\n\nSecond para\nstill second.\n\n- a\n- b\n\n```js\nlet x\n\nlet y\n```\n\nLast.'
    const parts = splitBlocks(t)
    expect(parts).toEqual([
      'First para.',
      'Second para\nstill second.',
      '- a\n- b',
      '```js\nlet x\n\nlet y\n```',
      'Last.'
    ])
    expect(splitBlocks('')).toEqual([])
    expect(splitBlocks('one')).toEqual(['one'])
  })
  test('example asks use real titles and always give up to three', () => {
    const a = exampleAsks(['Sourdough - Wikipedia', 'Mars - Wikipedia', 'Rust', 'Git'])
    expect(a.length).toBe(3)
    expect(a[0]).toBe('Compare Sourdough with Mars')
    expect(a).toContain('Group these tabs by topic')
    expect(exampleAsks([]).length).toBe(2)
    expect(exampleAsks(['x'.repeat(80) + ' y'])[0].length).toBeLessThan(60)
  })
  test('status lines exist for board tools only', () => {
    expect(boardStatus('tidy_up')).toBe('Arranging the board')
    expect(boardStatus('read_tab')).toBeNull()
  })
})
