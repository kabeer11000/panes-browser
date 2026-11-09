import { describe, expect, test } from 'bun:test'
import { addLoose, addNote, emptyState, fitFrames, intersects, patchNote, tidy } from './canvas'
import { itemFor } from './canvasItems'
import { addBlock, addShape, marksOf, patchMark } from './canvasMarks'
import { boardDigest } from './canvasDigest'
import { addPreset, PRESETS, presetAsk, presetBox } from './canvasPresets'
import { applyBoardTool, checkBoardCall } from './canvasTools'

const tabs = [
  { id: 1, url: 'https://a.com/x', title: 'Page [A]', private: false },
  { id: 2, url: 'https://b.com/', title: 'B', private: false },
  { id: 3, url: 'https://secret.com/', title: 'Secret', private: true }
]
const board = tidy(
  emptyState('b'),
  tabs.map((t) => ({ id: t.id, url: t.url, private: t.private })),
  [{ name: 'Reading', ids: [1, 2] }]
)

describe('boardDigest', () => {
  test('sections with links and notes, loose things, drawings; never a private tab', () => {
    let s = addLoose(board, itemFor('https://c.org/doc', 'Doc'), { point: { x: 3000, y: 0 } }).state
    const n = addNote(s, { x: 5000, y: 0 })
    s = patchNote(n.state, n.id, { text: 'remember\nthis' })
    const h = addShape(s, 'text', { x: 0, y: 4000 }, { x: 0, y: 4000 }, { text: 'Plan' })!
    s = patchMark(h.state, h.id, { size: 28 })
    s = addBlock(s, 'checklist', { x: 0, y: 4100 }, '[x] book\n[ ] pack')!.state
    s = addBlock(s, 'table', { x: 0, y: 4300 }, 'a\tb|c\n1\t2')!.state
    const md = boardDigest(s, tabs, 'Home board')
    expect(md.startsWith('# Home board\n')).toBe(true)
    expect(md).toContain('## Reading\n\n- [Page A](https://a.com/x)\n- [B](https://b.com/)')
    expect(md).toContain('## On the board\n\n- [Doc](https://c.org/doc)')
    expect(md).toContain('## Notes\n\n- remember this')
    expect(md).toContain('### Plan')
    expect(md).toContain('- [x] book\n- [ ] pack')
    expect(md).toContain('| a | b\\|c |\n| --- | --- |\n| 1 | 2 |')
    expect(md).not.toContain('secret')
    expect(md.endsWith('\n')).toBe(true)
    expect(md).not.toMatch(/\n{3}/)
  })
  test('an empty board is just its title', () => {
    expect(boardDigest(emptyState('b'), [], '')).toBe('# Board\n')
  })
})

describe('presets', () => {
  test('a row of named sections in free space, none on what is there', () => {
    const blocker = addShape(emptyState('b'), 'rect', { x: 0, y: 0 }, { x: 900, y: 900 })!.state
    const r = addPreset(blocker, 'trip', { x: 0, y: 0 })
    const frames = r.state.frames.filter((f) => r.ids.includes(f.id))
    expect(frames.map((f) => f.name)).toEqual(PRESETS.trip.frames)
    for (const f of frames) expect(intersects(f, { ...marksOf(blocker)[0] })).toBe(false)
    expect(presetBox(r.state, r.ids)!.w).toBeGreaterThan(frames[0].w * frames.length)
    // empty sections keep their room after the board settles
    const settled = fitFrames(r.state).frames.filter((f) => r.ids.includes(f.id))
    expect(settled.every((f) => f.w >= 500 && f.h >= 400)).toBe(true)
  })
  test('the ask names each section by id, and notes added near one go into it', () => {
    const r = addPreset(emptyState('b'), 'research', { x: 0, y: 0 })
    const frames = r.state.frames.map((f) => ({ id: f.id, name: f.name }))
    const q = presetAsk('research', 'heat pumps', frames)
    expect(q).toContain('heat pumps')
    for (const f of frames) expect(q).toContain(`"${f.name}" (${f.id})`)
    const chk = checkBoardCall('add_note', { text: 'COP above 3', near: frames[1].id })
    if (!chk.ok) throw new Error(chk.error)
    const done = applyBoardTool(r.state, chk.value, [], { x: 0, y: 0 })
    const card = done.state.cards.find(
      (c) => done.state.items[String(c.id)]?.text === 'COP above 3'
    )
    expect(card?.frame).toBe(frames[1].id)
  })
})
