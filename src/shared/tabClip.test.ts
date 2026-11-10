import { describe, expect, test } from 'bun:test'
import {
  addNote,
  CARD_H,
  CARD_W,
  cardBox,
  emptyState,
  GAP,
  intersects,
  tidy,
  type CanvasState,
  type TabLite
} from './ai/canvas'
import type { CanvasItem } from './ai/canvasItems'
import {
  clipText,
  layoutBoxes,
  nextClip,
  parseUrls,
  pasteOffset,
  pasteOnBoard,
  placeCards,
  removeFromBoard,
  resolvePaste,
  restoreOnBoard,
  type Clip,
  type ClipEntry
} from './tabClip'

const tabLite = (id: number): TabLite => ({ id, url: `https://site${id}.com/`, private: false })
const tabEntry = (id: number, box?: { x: number; y: number }): ClipEntry => ({
  kind: 'tab',
  id,
  url: `https://site${id}.com/`,
  title: `Site ${id}`,
  box: box ? { ...box, w: CARD_W, h: CARD_H } : undefined
})
const link: CanvasItem = {
  kind: 'page',
  url: 'https://example.com/a',
  title: 'A',
  site: 'example.com',
  tab: 7
}
/** A board with one loose link card (-2) and one loose note, nothing else. */
function looseBoard(): CanvasState {
  let s = emptyState('b')
  s = {
    ...s,
    seq: 1,
    cards: [{ id: -2, url: link.url, x: 0, y: 0, frame: null, manual: true, private: false }],
    items: { '-2': link }
  }
  const n = addNote(s, { x: 1000, y: 0 })
  return n.state
}

describe('the clip state machine', () => {
  const entries = [tabEntry(1)]
  test('copy and cut hold the entries and the text written out', () => {
    const c = nextClip(null, { type: 'copy', space: 3, entries })!
    expect(c.mode).toBe('copy')
    expect(c.space).toBe(3)
    expect(c.text).toBe('https://site1.com/')
    expect(nextClip(c, { type: 'cut', space: 4, entries })!.mode).toBe('cut')
  })
  test('copying nothing keeps what was held', () => {
    const c = nextClip(null, { type: 'copy', space: 1, entries })
    expect(nextClip(c, { type: 'cut', space: 1, entries: [] })).toBe(c)
    expect(nextClip(null, { type: 'copy', space: 1, entries: [] })).toBeNull()
  })
  test('a paste uses up a cut, not a copy', () => {
    const copy = nextClip(null, { type: 'copy', space: 1, entries })
    const cut = nextClip(null, { type: 'cut', space: 1, entries })
    expect(nextClip(copy, { type: 'pasted' })).toBe(copy)
    expect(nextClip(cut, { type: 'pasted' })).toBeNull()
  })
  test('Esc forgets a cut only', () => {
    const copy = nextClip(null, { type: 'copy', space: 1, entries })
    const cut = nextClip(null, { type: 'cut', space: 1, entries })
    expect(nextClip(copy, { type: 'escape' })).toBe(copy)
    expect(nextClip(cut, { type: 'escape' })).toBeNull()
    expect(nextClip(null, { type: 'escape' })).toBeNull()
  })
})

describe('clipboard text', () => {
  test('addresses one per line, links in html, escaped', () => {
    const r = clipText([
      { kind: 'tab', id: 1, url: 'https://a.com/?x=1&y=2', title: 'A <b> "q"' },
      { kind: 'item', id: -3, item: link, box: { x: 0, y: 0, w: 1, h: 1 } },
      { kind: 'tab', id: 2, url: 'https://b.com/', title: '' }
    ])
    expect(r.text).toBe('https://a.com/?x=1&y=2\nhttps://example.com/a\nhttps://b.com/')
    expect(r.html).toContain('<a href="https://a.com/?x=1&amp;y=2">A &lt;b&gt; &quot;q&quot;</a>')
    expect(r.html).toContain('<a href="https://b.com/">https://b.com/</a>') // no title: the address
  })
  test('a blank tab has no line; a note gives its text', () => {
    const s = looseBoard()
    const r = clipText([
      { kind: 'tab', id: 1, url: '', title: 'New tab' },
      { kind: 'note', note: { ...s.notes[0], text: 'hi\nthere' } },
      { kind: 'note', note: { ...s.notes[0], text: '   ' } }
    ])
    expect(r.text).toBe('hi\nthere')
    expect(r.html).toBe('<p>hi<br>there</p>')
  })
})

describe('parsing addresses', () => {
  test('one per line, blank lines and spaces ignored, bare hosts get https', () => {
    expect(parseUrls('https://a.com/x\r\n\n  example.org/y  \n')).toEqual([
      'https://a.com/x',
      'https://example.org/y'
    ])
  })
  test('any line that is not an address: not a list', () => {
    expect(parseUrls('https://a.com\nhello world')).toBeNull()
    expect(parseUrls('')).toBeNull()
    expect(parseUrls('   \n ')).toBeNull()
  })
  test('too many lines is not a list', () => {
    const many = Array.from({ length: 21 }, (_, i) => `https://s${i}.com`).join('\n')
    expect(parseUrls(many)).toBeNull()
    expect(parseUrls(many, 30)).toHaveLength(21)
  })
})

describe('what a paste means', () => {
  const clip: Clip = nextClip(null, {
    type: 'cut',
    space: 1,
    entries: [tabEntry(1), tabEntry(2)]
  })!
  test('the held tabs while the clipboard has their text (line endings and spaces aside)', () => {
    expect(resolvePaste(clip, 'https://site1.com/\r\nhttps://site2.com/\n').kind).toBe('clip')
  })
  test('the held tabs when the clipboard cannot be read', () => {
    expect(resolvePaste(clip, null)).toEqual({ kind: 'clip', clip })
  })
  test('something else copied since: addresses open, other text is not ours', () => {
    expect(resolvePaste(clip, 'https://other.com')).toEqual({
      kind: 'urls',
      urls: ['https://other.com']
    })
    expect(resolvePaste(clip, 'just words').kind).toBe('none')
    expect(resolvePaste(clip, '').kind).toBe('none') // a picture copied since
  })
  test('nothing held: addresses or nothing', () => {
    expect(resolvePaste(null, 'a.com\nb.com')).toEqual({
      kind: 'urls',
      urls: ['https://a.com', 'https://b.com']
    })
    expect(resolvePaste(null, null).kind).toBe('none')
  })
})

describe('placement keeping the layout', () => {
  test('boxes without a place go in a row to the right of the rest', () => {
    const b = layoutBoxes([{ x: 10, y: 20, w: CARD_W, h: CARD_H }, undefined, undefined])
    expect(b[1]).toEqual({ x: 10 + CARD_W + GAP, y: 20, w: CARD_W, h: CARD_H })
    expect(b[2].x).toBe(10 + 2 * (CARD_W + GAP))
  })
  test('with no places at all the row starts at 0', () => {
    expect(layoutBoxes([undefined, undefined]).map((b) => b.x)).toEqual([0, CARD_W + GAP])
  })
  test('the offset centres the group on the point', () => {
    const boxes = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 200, y: 100, w: 100, h: 100 }
    ]
    expect(pasteOffset(boxes, { x: 1000, y: 1000 })).toEqual({ dx: 850, dy: 900 })
    expect(pasteOffset([], { x: 5, y: 5 })).toEqual({ dx: 0, dy: 0 })
  })
})

describe('pasting on a board', () => {
  test('a copy adds new notes and items at the point, keeping their spacing; tabs are handed back', () => {
    const s = looseBoard()
    const note = s.notes[0]
    const entries: ClipEntry[] = [
      { kind: 'item', id: -2, item: link, box: cardBox(s.cards[0]) },
      { kind: 'note', note },
      tabEntry(9, { x: 0, y: 2000 })
    ]
    const boxes = layoutBoxes(entries.map((e) => (e.kind === 'note' ? e.note : e.box)))
    const at = { x: 5000, y: 5000 }
    const r = pasteOnBoard(s, entries, boxes, pasteOffset(boxes, at), at, false)
    expect(r.state.cards).toHaveLength(2)
    expect(r.state.notes).toHaveLength(2)
    const made = r.state.cards.find((c) => c.id !== -2)!
    const madeNote = r.state.notes.find((n) => n.id !== note.id)!
    expect(r.keys).toEqual([`c:${made.id}`, `n:${madeNote.id}`])
    // the copied item is its own, not shown by the original's tab
    expect(r.state.items[String(made.id)].tab).toBeUndefined()
    expect(r.state.items[String(made.id)].url).toBe(link.url)
    // spacing kept: the note is as far right of the card as before
    expect(madeNote.x - made.x).toBe(note.x - s.cards[0].x)
    expect(r.tabs).toHaveLength(1)
    expect(r.tabs[0].entry.id).toBe(9)
    expect(r.tabs[0].x - made.x).toBe(0 - s.cards[0].x)
    expect(r.tabs[0].y - made.y).toBe(2000 - s.cards[0].y)
    // the originals are untouched
    expect(r.state.cards.find((c) => c.id === -2)).toEqual(s.cards[0])
  })
  test('a cut from this board moves what is here instead', () => {
    const s = looseBoard()
    const entries: ClipEntry[] = [
      { kind: 'item', id: -2, item: link, box: cardBox(s.cards[0]) },
      { kind: 'note', note: s.notes[0] }
    ]
    const boxes = layoutBoxes(entries.map((e) => (e.kind === 'note' ? e.note : e.box)))
    const at = { x: 3000, y: 3000 }
    const d = pasteOffset(boxes, at)
    const r = pasteOnBoard(s, entries, boxes, d, at, true)
    expect(r.state.cards).toHaveLength(1)
    expect(r.state.notes).toHaveLength(1)
    expect(r.state.cards[0].x).toBe(s.cards[0].x + d.dx)
    expect(r.state.notes[0].x).toBe(s.notes[0].x + d.dx)
    expect(r.keys).toEqual(['c:-2', `n:${s.notes[0].id}`])
    expect(r.tabs).toHaveLength(0)
  })
  test('a cut tab with its card here moves; a copied one is handed back', () => {
    const s = tidy(emptyState('b'), [tabLite(1)], [])
    const box = cardBox(s.cards[0])
    const entries: ClipEntry[] = [tabEntry(1, box)]
    const at = { x: 4000, y: 4000 }
    const d = pasteOffset([box], at)
    const moved = pasteOnBoard(s, entries, [box], d, at, true)
    expect(moved.tabs).toHaveLength(0)
    expect(moved.keys).toEqual(['c:1'])
    expect(moved.state.cards[0].frame).toBeNull() // left its section, loose at the point
    expect(moved.state.cards[0].x).toBe(box.x + d.dx)
    const copied = pasteOnBoard(s, entries, [box], d, at, false)
    expect(copied.tabs).toHaveLength(1)
    expect(copied.state.cards).toEqual(s.cards)
  })
  test('pasting over a section puts things in it', () => {
    const s0 = tidy(emptyState('b'), [tabLite(1), tabLite(2)], [{ name: 'G', ids: [1, 2] }])
    const f = s0.frames.find((x) => x.name === 'G')!
    const s = {
      ...s0,
      seq: s0.seq + 1,
      cards: [
        ...s0.cards,
        { id: -50, url: link.url, x: -3000, y: -3000, frame: null, manual: true, private: false }
      ],
      items: { '-50': link }
    }
    const entries: ClipEntry[] = [{ kind: 'item', id: -50, item: link, box: cardBox(s.cards[2]) }]
    const boxes = [cardBox(s.cards[2])]
    const at = { x: f.x + f.w / 2, y: f.y + f.h / 2 }
    const r = pasteOnBoard(s, entries, boxes, pasteOffset(boxes, at), at, false)
    const made = r.state.cards.find((c) => c.id !== -50 && c.id < 0)!
    expect(made.frame).toBe(f.id)
    const r2 = pasteOnBoard(s, entries, boxes, pasteOffset(boxes, at), at, true)
    expect(r2.state.cards.find((c) => c.id === -50)!.frame).toBe(f.id)
  })
  test('placed duplicates do not overlap what is there', () => {
    const s = looseBoard()
    const entries: ClipEntry[] = [{ kind: 'item', id: -2, item: link, box: cardBox(s.cards[0]) }]
    const boxes = [cardBox(s.cards[0])]
    // Ctrl+D: in place, offset a little
    const at = { x: boxes[0].x + boxes[0].w / 2 + 32, y: boxes[0].y + boxes[0].h / 2 + 32 }
    const r = pasteOnBoard(s, entries, boxes, { dx: 32, dy: 32 }, at, false)
    const made = r.state.cards.find((c) => c.id !== -2)!
    expect(intersects(cardBox(made), cardBox(s.cards[0]))).toBe(false)
  })
})

describe('placing tab cards that arrive later', () => {
  test('cards here go to their places; unknown ids are skipped', () => {
    const s = tidy(emptyState('b'), [tabLite(1), tabLite(2)], [])
    const at = { x: 9000, y: 9000 }
    const r = placeCards(
      s,
      [
        { id: 1, x: 9000, y: 9000 },
        { id: 2, x: 9000 + CARD_W + GAP, y: 9000 },
        { id: 99, x: 0, y: 0 }
      ],
      at
    )
    const c1 = r.cards.find((c) => c.id === 1)!
    const c2 = r.cards.find((c) => c.id === 2)!
    expect(c1.x).toBe(9000)
    expect(c2.x - c1.x).toBe(CARD_W + GAP)
    expect(placeCards(s, [{ id: 99, x: 0, y: 0 }], at)).toBe(s)
  })
})

describe('a cut moved to another board', () => {
  test('notes and items leave the source and come back on undo', () => {
    const before = looseBoard()
    const entries: ClipEntry[] = [
      { kind: 'item', id: -2, item: link, box: cardBox(before.cards[0]) },
      { kind: 'note', note: before.notes[0] },
      tabEntry(5)
    ]
    const gone = removeFromBoard(before, entries)
    expect(gone.cards).toHaveLength(0)
    expect(gone.notes).toHaveLength(0)
    expect(gone.items['-2']).toBeUndefined()
    const back = restoreOnBoard(gone, before, entries)
    expect(back.cards).toEqual(before.cards)
    expect(back.notes).toEqual(before.notes)
    expect(back.items['-2']).toEqual(link)
    // nothing doubled when it is already there
    expect(restoreOnBoard(before, before, entries)).toBe(before)
  })
  test('a restored note whose section is gone comes back loose', () => {
    const before = looseBoard()
    const inFrame = { ...before, notes: [{ ...before.notes[0], frame: 'f-gone' }] }
    const entries: ClipEntry[] = [{ kind: 'note', note: inFrame.notes[0] }]
    const back = restoreOnBoard(removeFromBoard(inFrame, entries), inFrame, entries)
    expect(back.notes[0].frame).toBeNull()
  })
})
