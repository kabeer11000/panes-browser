import { describe, expect, test } from 'bun:test'
import {
  addLoose,
  addNote,
  boundsOf,
  cardBox,
  emptyState,
  fitView,
  intersects,
  type CanvasState
} from './canvas'
import { itemFor } from './canvasItems'
import {
  addBlock,
  addShape,
  addStroke,
  alignMarks,
  blockHeight,
  checkLines,
  contentBoxes,
  deleteMarks,
  distributeMarks,
  duplicateMarks,
  groupMarks,
  layFlow,
  markBox,
  marksOf,
  moveMarks,
  parseTable,
  patchMark,
  sanitizeMarks,
  shapePath,
  tableText,
  toggleCheck,
  ungroupMarks,
  withGroups
} from './canvasMarks'
import { addConnector, endBox, objectAt, pruneConnectors, sanitizeConnectors } from './connectors'
import { applyBoardTool, checkBoardCall } from './canvasTools'

const s0 = emptyState('b')
/** A board with `n` 100 by 50 rectangles at the given x positions (y 0). */
function rects(xs: number[]): { s: CanvasState; ids: string[] } {
  let s = s0
  const ids: string[] = []
  for (const x of xs) {
    const r = addShape(s, 'rect', { x, y: 0 }, { x: x + 100, y: 50 })!
    s = r.state
    ids.push(r.id)
  }
  return { s, ids }
}
const at = (s: CanvasState, id: string): { x: number; y: number } => {
  const m = marksOf(s).find((x) => x.id === id)!
  return { x: m.x, y: m.y }
}

describe('arrow shape', () => {
  test('is a closed path inside its box', () => {
    const d = shapePath('arrow', 200, 80)
    expect(d.startsWith('M0 ')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
    expect(Math.max(...nums)).toBeLessThanOrEqual(200)
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(0)
  })
})

describe('blocks', () => {
  test('a new block has text and the height its lines need', () => {
    const t = addBlock(s0, 'table', { x: 10, y: 20 })!
    const m = marksOf(t.state)[0]
    expect(m).toMatchObject({ kind: 'table', x: 10, y: 20 })
    expect(m.h).toBe(blockHeight('table', m.text!))
    const c = addBlock(s0, 'checklist', { x: 0, y: 0 }, '[ ] a\n[x] b\n[ ] c')!
    expect(marksOf(c.state)[0].h).toBe(blockHeight('checklist', '[ ] a\n[x] b\n[ ] c'))
  })
  test("editing the text resizes the block, width stays the person's", () => {
    const c = addBlock(s0, 'code', { x: 0, y: 0 }, 'a')!
    const one = marksOf(c.state)[0].h
    const more = patchMark(c.state, c.id, { text: 'a\nb\nc\nd', w: 500 })
    const m = marksOf(more)[0]
    expect(m.h).toBeGreaterThan(one)
    expect(m.w).toBe(500)
    // a dragged height does not stick
    expect(marksOf(patchMark(more, c.id, { h: 999 }))[0].h).toBe(m.h)
  })
  test('tables are padded rectangles and round-trip', () => {
    const rows = parseTable('a\tb\tc\nd')
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['d', '', '']
    ])
    expect(parseTable(tableText(rows))).toEqual(rows)
    // tabs and line breaks typed into a cell cannot break the grid
    expect(parseTable(tableText([['x\ty', 'z\nw']]))).toEqual([['x y', 'z w']])
    expect(parseTable('')).toEqual([['']])
  })
  test('checklists tick and untick one line', () => {
    expect(checkLines('[x] done\n[ ] todo\nplain')).toEqual([
      { done: true, text: 'done' },
      { done: false, text: 'todo' },
      { done: false, text: 'plain' }
    ])
    const t = toggleCheck('[ ] a\n[ ] b', 1)
    expect(t).toBe('[ ] a\n[x] b')
    expect(toggleCheck(t, 1)).toBe('[ ] a\n[ ] b')
  })
  test('blocks and groups survive saving', () => {
    const b = addBlock(s0, 'checklist', { x: 0, y: 0 })!
    const g = groupMarks(addShape(b.state, 'arrow', { x: 0, y: 0 }, { x: 90, y: 40 })!.state, [
      'm1',
      'm2'
    ])!
    const back = sanitizeMarks(JSON.parse(JSON.stringify(marksOf(g.state))))
    expect(back.map((m) => m.kind)).toEqual(['checklist', 'arrow'])
    expect(back.every((m) => m.group === g.id)).toBe(true)
    expect(back[0].text).toContain('[ ]')
    expect(
      sanitizeMarks([{ id: 'x', kind: 'table', x: 0, y: 0, w: 1, h: 1, group: 7 }])[0].group
    ).toBeUndefined()
  })
})

describe('groups', () => {
  test('group, select the whole group from one, ungroup', () => {
    const { s, ids } = rects([0, 200, 400])
    expect(groupMarks(s, [ids[0]])).toBeNull()
    const g = groupMarks(s, [ids[0], ids[1]])!
    expect(withGroups(g.state, [ids[0]])).toEqual([ids[0], ids[1]])
    expect(withGroups(g.state, [ids[2]])).toEqual([ids[2]])
    const u = ungroupMarks(g.state, [ids[1]])
    expect(withGroups(u, [ids[0]])).toEqual([ids[0]])
    expect(ungroupMarks(u, [ids[0]])).toBe(u)
  })
  test('a duplicated group is a new group of the copies', () => {
    const { s, ids } = rects([0, 200])
    const g = groupMarks(s, ids)!
    const d = duplicateMarks(g.state, ids)
    const copies = marksOf(d.state).filter((m) => d.ids.includes(m.id))
    expect(copies[0].group).toBeDefined()
    expect(copies[0].group).toBe(copies[1].group)
    expect(copies[0].group).not.toBe(g.id)
    expect(withGroups(d.state, [d.ids[0]])).toEqual(d.ids)
  })
})

describe('moving, aligning, distributing', () => {
  test('locked marks do not move; lines carry their points', () => {
    const { s, ids } = rects([0, 200])
    const locked = patchMark(s, ids[1], { locked: true })
    const m = moveMarks(locked, ids, 10, 5)
    expect(at(m, ids[0])).toEqual({ x: 10, y: 5 })
    expect(at(m, ids[1])).toEqual({ x: 200, y: 0 })
    const l = addStroke(s0, 'pen', [0, 0, 40, 0, 80, 20])!
    const lm = moveMarks(l.state, [l.id], 5, 5)
    expect(marksOf(lm)[0].pts!.slice(0, 2)).toEqual([5, 5])
    expect(moveMarks(s, ids, 0, 0)).toBe(s)
  })
  test('align left, right, middle', () => {
    const r0 = rects([0, 300])
    const ids = r0.ids
    const s = patchMark(r0.s, ids[1], { y: 100, w: 50 })
    expect(at(alignMarks(s, ids, 'left'), ids[1]).x).toBe(0)
    const r = alignMarks(s, ids, 'right')
    expect(at(r, ids[1]).x).toBe(300)
    expect(at(r, ids[0]).x).toBe(250)
    const mid = alignMarks(s, ids, 'middle')
    expect(at(mid, ids[0]).y).toBe(at(mid, ids[1]).y)
    expect(alignMarks(s, [ids[0]], 'left')).toBe(s)
  })
  test('a group aligns as one block', () => {
    const { s, ids } = rects([0, 150, 500])
    const g = groupMarks(patchMark(s, ids[2], { y: 200 }), [ids[0], ids[1]])!
    const a = alignMarks(g.state, ids, 'right')
    // the group's right edge (250) moves to 600: both members shift by 350
    expect(at(a, ids[0]).x).toBe(350)
    expect(at(a, ids[1]).x).toBe(500)
  })
  test('distribute leaves even gaps and keeps the ends', () => {
    const { s, ids } = rects([0, 130, 600])
    const d = distributeMarks(s, ids, 'x')
    expect(at(d, ids[0]).x).toBe(0)
    expect(at(d, ids[2]).x).toBe(600)
    // span 700, widths 300: gaps of 200
    expect(at(d, ids[1]).x).toBe(300)
    expect(distributeMarks(s, ids.slice(0, 2), 'x')).toBe(s)
  })
})

describe('fit and connectors see drawings', () => {
  test('a board of only shapes still has something to fit', () => {
    const { s } = rects([5000, 5200])
    const b = boundsOf(contentBoxes(s))!
    expect(b.x).toBe(5000)
    const v = fitView(b, 1200, 800)
    // the shapes are on screen
    expect(5000 * v.k + v.x).toBeGreaterThan(0)
    expect(5300 * v.k + v.x).toBeLessThan(1200)
  })
  test('arrows attach to shapes and blocks, and go with them', () => {
    const { s, ids } = rects([0, 400])
    expect(objectAt(s, { x: 50, y: 25 })).toEqual({ kind: 'mark', id: ids[0] })
    const pen = addStroke(s, 'pen', [0, 100, 50, 100])!
    expect(objectAt(pen.state, { x: 25, y: 100 })).toBeNull()
    const c = addConnector(s, { kind: 'mark', id: ids[0] }, { kind: 'mark', id: ids[1] })!
    expect(endBox(c.state, { kind: 'mark', id: ids[1] })).toEqual({ x: 400, y: 0, w: 100, h: 50 })
    const saved = sanitizeConnectors(JSON.parse(JSON.stringify(c.state.connectors)))
    expect(saved[0].to).toEqual({ kind: 'mark', id: ids[1] })
    const gone = pruneConnectors(deleteMarks(c.state, [ids[1]]))
    expect(gone.connectors).toEqual([])
    // a pen line is never an end
    expect(
      addConnector(pen.state, { kind: 'mark', id: pen.id }, { kind: 'mark', id: ids[0] })
    ).toBeNull()
  })
})

describe('flowchart tool', () => {
  test('steps become shapes joined by arrows, in free space, as one step', () => {
    const chk = checkBoardCall('flowchart', { steps: ['Start', 'Paid?', 'Ship it'] })
    expect(chk.ok).toBe(true)
    if (!chk.ok) return
    const blocker = addShape(s0, 'rect', { x: 0, y: 0 }, { x: 300, y: 300 })!
    const r = applyBoardTool(blocker.state, chk.value, [], { x: 0, y: 0 })
    const shapes = marksOf(r.state).slice(1)
    expect(shapes.map((m) => [m.kind, m.text])).toEqual([
      ['rounded', 'Start'],
      ['diamond', 'Paid?'],
      ['rounded', 'Ship it']
    ])
    // nothing lands on what was there
    for (const m of shapes) expect(m.x >= 300 || m.y >= 300 || m.x + m.w <= 0).toBe(true)
    expect(r.state.connectors!.map((k) => [k.from, k.to])).toEqual([
      [
        { kind: 'mark', id: shapes[0].id },
        { kind: 'mark', id: shapes[1].id }
      ],
      [
        { kind: 'mark', id: shapes[1].id },
        { kind: 'mark', id: shapes[2].id }
      ]
    ])
    expect(r.said).toBe('Drew a flowchart of 3 steps')
    expect(r.result).toContain(shapes[0].id)
  })
  test('bad input is refused with a reason', () => {
    expect(checkBoardCall('flowchart', { steps: ['only one'] }).ok).toBe(false)
    expect(checkBoardCall('flowchart', { steps: 'a, b' }).ok).toBe(false)
    expect(layFlow(s0, ['  ', ''], { x: 0, y: 0 })).toBeNull()
  })
  test('connect joins shapes, not notes, when given mark ids', () => {
    const { s, ids } = rects([0, 300])
    const chk = checkBoardCall('connect', { fromId: ids[0], toId: ids[1] })
    if (!chk.ok) throw new Error(chk.error)
    const r = applyBoardTool(s, chk.value, [], { x: 0, y: 0 })
    expect(r.state.connectors![0].to).toEqual({ kind: 'mark', id: ids[1] })
  })
})

describe('add_shape', () => {
  test('shapes added one after another do not pile up', () => {
    let s = s0
    for (let i = 0; i < 3; i++) {
      const chk = checkBoardCall('add_shape', { kind: 'star' })
      if (!chk.ok) throw new Error(chk.error)
      s = applyBoardTool(s, chk.value, [], { x: 0, y: 0 }).state
    }
    const ms = marksOf(s)
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++)
        expect(intersects(markBox(ms[i]), markBox(ms[j]))).toBe(false)
  })
})

describe('new things keep clear of drawings', () => {
  test('a loose card and a note do not land on a shape', () => {
    const sh = addShape(s0, 'rect', { x: 0, y: 0 }, { x: 400, y: 400 })!
    const c = addLoose(sh.state, itemFor('https://a.com/', ''), { point: { x: 10, y: 10 } })
    const card = c.state.cards.find((x) => x.id === c.id)!
    expect(intersects(cardBox(card), markBox(marksOf(sh.state)[0]))).toBe(false)
    const n = addNote(sh.state, { x: 20, y: 20 })
    expect(intersects(n.state.notes[0], markBox(marksOf(sh.state)[0]))).toBe(false)
  })
})
