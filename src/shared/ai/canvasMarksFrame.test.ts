import { describe, expect, test } from 'bun:test'
import {
  deleteFrame,
  dropMarks,
  emptyState,
  forDisk,
  moveFrame,
  tidy,
  type CanvasState,
  type TabLite
} from './canvas'
import { addBlock, addStroke, type CanvasMark } from './canvasMarks'

const tab = (id: number): TabLite => ({ id, url: `https://site${id}.com/`, private: false })

const board = (): { s: CanvasState; fid: string } => {
  const s = tidy(emptyState('b'), [tab(1), tab(2)], [{ name: 'G', ids: [1, 2] }])
  return { s, fid: s.frames.find((x) => x.name === 'G')!.id }
}

const mark = (s: CanvasState, id: string): CanvasMark => s.marks!.find((m) => m.id === id)!

describe('tables and drawings in sections', () => {
  test('a table let go inside a section joins it where it was put, and the section grows round it', () => {
    const { s: s0, fid } = board()
    const f = s0.frames.find((x) => x.id === fid)!
    const made = addBlock(s0, 'table', { x: f.x + f.w + 3000, y: f.y })!
    const t = mark(made.state, made.id)
    expect(t.frame).toBeUndefined()
    // its middle lands just inside the section's right edge, so most of it hangs out
    const dx = f.x + f.w - 20 - (t.x + t.w / 2)
    const dy = f.y + f.h / 2 - (t.y + t.h / 2)
    const s = dropMarks(made.state, [made.id], dx, dy)
    const m = mark(s, made.id)
    expect(m.frame).toBe(fid)
    expect(m.x).toBe(t.x + dx) // kept where it was let go, not slotted
    const g = s.frames.find((x) => x.id === fid)!
    expect(g.x + g.w).toBeGreaterThanOrEqual(m.x + m.w)
    expect(g.y + g.h).toBeGreaterThanOrEqual(m.y + m.h)
  })

  test('it moves with its section, leaves when dragged out, and is freed when the section goes', () => {
    const { s: s0, fid } = board()
    const f = s0.frames.find((x) => x.id === fid)!
    const made = addBlock(s0, 'checklist', { x: f.x + f.w + 3000, y: f.y })!
    const t = mark(made.state, made.id)
    let s = dropMarks(made.state, [made.id], f.x + 40 - t.x, f.y + 60 - t.y)
    const inSection = mark(s, made.id)
    expect(inSection.frame).toBe(fid)
    const moved = moveFrame(s, fid, 0, 4000)
    const dy = moved.frames.find((x) => x.id === fid)!.y - s.frames.find((x) => x.id === fid)!.y
    expect(mark(moved, made.id).y).toBe(inSection.y + dy)
    expect(mark(deleteFrame(s, fid), made.id).frame).toBeUndefined()
    s = dropMarks(s, [made.id], 0, 9000)
    expect(mark(s, made.id).frame).toBeUndefined()
  })

  test('a drawing carries its points with the section', () => {
    const { s: s0, fid } = board()
    const f = s0.frames.find((x) => x.id === fid)!
    const made = addStroke(s0, 'pen', [f.x + 3000, f.y, f.x + 3040, f.y + 30], 0)!
    const m0 = mark(made.state, made.id)
    let s = dropMarks(made.state, [made.id], f.x + 40 - m0.x, f.y + 60 - m0.y)
    const before = mark(s, made.id)
    s = moveFrame(s, fid, 0, 4000)
    const dx = mark(s, made.id).x - before.x
    const dy = mark(s, made.id).y - before.y
    expect(dy).not.toBe(0)
    expect(mark(s, made.id).pts).toEqual(before.pts!.map((v, i) => v + (i % 2 ? dy : dx)))
  })

  test('section membership survives a save and load', () => {
    const { s: s0, fid } = board()
    const f = s0.frames.find((x) => x.id === fid)!
    const made = addBlock(s0, 'table', { x: f.x + f.w + 3000, y: f.y })!
    const t = mark(made.state, made.id)
    const s = dropMarks(made.state, [made.id], f.x + 40 - t.x, f.y + 60 - t.y)
    const back = forDisk(JSON.parse(JSON.stringify(s)) as CanvasState)
    expect(mark(back, made.id).frame).toBe(fid)
  })
})
