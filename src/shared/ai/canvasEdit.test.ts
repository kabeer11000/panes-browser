import { describe, expect, test } from 'bun:test'
import {
  CARD_W,
  emptyState,
  forDisk,
  FRAME_MIN,
  placeCard,
  reconcileSaved,
  resizeFrame,
  setCardView,
  setFrameColor,
  syncTabs,
  tidy,
  addNote,
  deleteFrame,
  dropNote,
  fitFrames,
  HEAD,
  hugBox,
  intersects,
  moveFrame,
  noteHeight,
  NOTE_MAX_H,
  NOTE_MIN_H,
  NOTE_MIN_W,
  PAD,
  resizeNote,
  unsizeFrame,
  type CanvasState,
  type TabLite
} from './canvas'
import { kindOf, pdfSource } from './canvasItems'

const tab = (id: number): TabLite => ({ id, url: `https://site${id}.com/`, private: false })

describe('frames like sections', () => {
  const s0 = tidy(emptyState('b'), [tab(1), tab(2), tab(3)], [{ name: 'G', ids: [1, 2, 3] }])
  const f = s0.frames.find((x) => x.name === 'G')!
  test('a colour is kept, cleared, and pins the frame', () => {
    const s = setFrameColor(s0, f.id, 3)
    expect(s.frames.find((x) => x.id === f.id)).toMatchObject({ color: 3, pinned: true })
    expect(setFrameColor(s, f.id, 3)).toBe(s)
    expect(setFrameColor(s, f.id, 99).frames.find((x) => x.id === f.id)!.color).toBe(6)
    expect('color' in setFrameColor(s, f.id, null).frames.find((x) => x.id === f.id)!).toBe(false)
  })
  test('a resize lets go of cards left outside and takes loose cards now inside', () => {
    // narrow it to its first column (of two): the card of the second falls out
    const narrow = resizeFrame(s0, f.id, { x: f.x, y: f.y, w: CARD_W + 40, h: f.h })
    const inFrame = narrow.cards.filter((c) => c.frame === f.id)
    expect(inFrame.length).toBe(2)
    expect(narrow.cards.filter((c) => c.frame === null).every((c) => c.manual)).toBe(true)
    // back to its size: they come back in
    const wide = resizeFrame(narrow, f.id, f)
    expect(wide.cards.filter((c) => c.frame === f.id).length).toBe(3)
    // never smaller than the minimum
    const tiny = resizeFrame(s0, f.id, { x: f.x, y: f.y, w: 5, h: 5 })
    expect(tiny.frames.find((x) => x.id === f.id)).toMatchObject(FRAME_MIN)
  })
})

describe('card views and placing', () => {
  test('a card view is remembered by address and survives a save and load', () => {
    let s = syncTabs(emptyState('b'), [tab(1)]).state
    s = setCardView(s, tab(1).url, 'snapshot')
    expect(s.views).toEqual({ [tab(1).url]: 'snapshot' })
    expect(setCardView(s, tab(1).url, 'snapshot')).toBe(s)
    const later = reconcileSaved(JSON.parse(JSON.stringify(forDisk(s))), [tab(1)], 'b2')
    expect(later.views).toEqual({ [tab(1).url]: 'snapshot' })
    expect(setCardView(s, tab(1).url, null).views).toEqual({})
    const bad = reconcileSaved(
      { ...s, views: { x: 'reader', [tab(1).url]: 'live' } as never },
      [],
      'b'
    )
    expect(bad.views).toEqual({})
  })
  test('placeCard puts a new card loose at a point on empty board', () => {
    const s = syncTabs(emptyState('b'), [tab(1)]).state
    const p = placeCard(s, 1, { x: 5000, y: 5000 })
    const c = p.cards.find((x) => x.id === 1)!
    expect(c.frame).toBeNull()
    expect(c.x).toBe(5000 - CARD_W / 2)
  })
})

describe('pdfSource', () => {
  test('a Chromium PDF viewer address gives the PDF it shows', () => {
    const id = 'oemmndcbldboiebfnladdacbdfmadadm'
    expect(pdfSource(`chrome-extension://${id}/file:///C:/Users/a/book%20one.pdf`)).toBe(
      'file:///C:/Users/a/book%20one.pdf'
    )
    expect(pdfSource(`chrome-extension://${id}/https://x.org/a.pdf`)).toBe('https://x.org/a.pdf')
    expect(pdfSource('https://x.org/a.pdf')).toBe('https://x.org/a.pdf')
    expect(pdfSource(`chrome-extension://${id}/index.html`)).toBe(
      `chrome-extension://${id}/index.html`
    )
    expect(kindOf(`chrome-extension://${id}/file:///C:/a.pdf`)).toBe('pdf')
  })
})

describe('sections hug what is in them', () => {
  const base = (): CanvasState =>
    tidy(emptyState('b'), [tab(1), tab(2), tab(3), tab(4)], [{ name: 'G', ids: [1, 2, 3, 4] }])
  test('a tidy section is exactly its cards plus even padding and the title row', () => {
    const s = base()
    const f = s.frames.find((x) => x.name === 'G')!
    expect(hugBox(s, f.id)).toEqual({ x: f.x, y: f.y, w: f.w, h: f.h })
    expect(fitFrames(s)).toBe(s)
    const first = s.cards.find((c) => c.frame === f.id)!
    expect(first.x - f.x).toBe(PAD)
    expect(first.y - f.y).toBe(HEAD)
  })
  test('closing a tab closes the gap: the grid stays tidy and the section shrinks to it', () => {
    const s = base()
    const f = s.frames.find((x) => x.name === 'G')!
    const after = syncTabs(s, [tab(1), tab(3), tab(4)]).state
    const g = after.frames.find((x) => x.id === f.id)!
    const cs = after.cards.filter((c) => c.frame === f.id)
    expect(cs.length).toBe(3)
    expect(hugBox(after, f.id)).toEqual({ x: g.x, y: g.y, w: g.w, h: g.h })
  })
  test('a section resized by hand only grows to keep its contents inside', () => {
    const s = base()
    const f = s.frames.find((x) => x.name === 'G')!
    const big = resizeFrame(s, f.id, { ...f, w: f.w + 400, h: f.h + 300 })
    expect(fitFrames(big)).toBe(big)
    // a card moved out past its edge (still a member): the section grows to it
    const c = big.cards.find((x) => x.frame === f.id)!
    const out = {
      ...big,
      cards: big.cards.map((x) => (x.id === c.id ? { ...x, x: x.x + 2000 } : x))
    }
    const grown = fitFrames(out).frames.find((x) => x.id === f.id)!
    expect(grown.x + grown.w).toBeGreaterThanOrEqual(c.x + 2000 + CARD_W)
    // and back to hugging
    expect(unsizeFrame(big, f.id).frames.find((x) => x.id === f.id)!.sized).toBeUndefined()
  })
  test('a section that grows pushes its neighbours aside: no overlap after a fit', () => {
    const s = tidy(
      emptyState('b'),
      [tab(1), tab(2), tab(3), tab(4)],
      [
        { name: 'A', ids: [1, 2] },
        { name: 'B', ids: [3, 4] }
      ]
    )
    const a = s.frames.find((x) => x.name === 'A')!
    const c = s.cards.find((x) => x.frame === a.id)!
    // a member card dragged far down: A grows over wherever B is
    const moved = {
      ...s,
      cards: s.cards.map((x) => (x.id === c.id ? { ...x, y: x.y + 900, x: x.x + 600 } : x))
    }
    const fit = fitFrames(moved)
    const [f1, f2] = fit.frames.filter((f) => f.name === 'A' || f.name === 'B')
    expect(intersects(f1, f2)).toBe(false)
  })
})

describe('notes in sections', () => {
  test('a note dropped inside a section joins it, moves with it, and leaves when dragged out', () => {
    let s = tidy(emptyState('b'), [tab(1), tab(2)], [{ name: 'G', ids: [1, 2] }])
    const f = s.frames.find((x) => x.name === 'G')!
    const made = addNote(s, { x: f.x + f.w + 2000, y: f.y })
    s = made.state
    const n0 = s.notes.find((x) => x.id === made.id)!
    expect(n0.frame ?? null).toBeNull()
    s = dropNote(s, made.id, f.x + PAD + 10 - n0.x, f.y + HEAD + 10 - n0.y)
    expect(s.notes.find((x) => x.id === made.id)!.frame).toBe(f.id)
    // it counts in the section's size
    const g = s.frames.find((x) => x.id === f.id)!
    const n = s.notes.find((x) => x.id === made.id)!
    expect(n.x >= g.x && n.x + n.w <= g.x + g.w && n.y + n.h <= g.y + g.h).toBe(true)
    // the section moves, the note with it
    const m = moveFrame(s, f.id, 0, 5000)
    expect(m.notes.find((x) => x.id === made.id)!.y).toBe(n.y + 5000)
    // dragged out: loose again
    const out = dropNote(s, made.id, 0, 9000)
    expect(out.notes.find((x) => x.id === made.id)!.frame).toBeNull()
  })
  test('a note made inside a section lands in it; deleting the section lets its notes go', () => {
    const s = tidy(emptyState('b'), [tab(1), tab(2)], [{ name: 'G', ids: [1, 2] }])
    const f = s.frames.find((x) => x.name === 'G')!
    const made = addNote(s, { x: f.x + 40, y: f.y + 60 })
    expect(made.state.notes.find((x) => x.id === made.id)!.frame).toBe(f.id)
    const gone = deleteFrame(made.state, f.id)
    expect(gone.notes.find((x) => x.id === made.id)!.frame).toBeNull()
  })
  test('tidy keeps the notes of a section inside it; old boards and missing sections load loose', () => {
    const s0 = tidy(emptyState('b'), [tab(1), tab(2)], [{ name: 'G', ids: [1, 2] }])
    const f = s0.frames.find((x) => x.name === 'G')!
    const made = addNote(s0, { x: f.x + 40, y: f.y + 60 })
    const t = tidy(made.state, [tab(1), tab(2)], [{ name: 'G', ids: [1, 2] }], true)
    const n = t.notes.find((x) => x.id === made.id)!
    const g = t.frames.find((x) => x.id === n.frame)
    if (g)
      expect(n.x >= g.x && n.y >= g.y && n.x + n.w <= g.x + g.w && n.y + n.h <= g.y + g.h).toBe(
        true
      )
    else expect(n.frame).toBeNull()
    const old = { ...made.state, notes: made.state.notes.map((x) => ({ ...x, frame: 'nope' })) }
    expect(reconcileSaved(old, [tab(1), tab(2)], 'b').notes.every((x) => x.frame === null)).toBe(
      true
    )
  })
  test('note sizes: height follows the text within bounds, a dragged height is a minimum', () => {
    expect(noteHeight(10)).toBe(NOTE_MIN_H)
    expect(noteHeight(200)).toBe(224)
    expect(noteHeight(5000)).toBe(NOTE_MAX_H)
    expect(noteHeight(10, 300)).toBe(300)
    const made = addNote(emptyState('b'), { x: 0, y: 0 })
    const r = resizeNote(made.state, made.id, { w: 10, h: 400 })
    const n = r.notes[0]
    expect(n.w).toBe(NOTE_MIN_W)
    expect(n.minH).toBe(400)
    expect(n.h).toBe(400)
  })
})
