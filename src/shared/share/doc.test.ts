import { describe, expect, test } from 'bun:test'
import * as Y from 'yjs'
import { emptyState, type CanvasCard, type CanvasNote, type CanvasState } from '../ai/canvas'
import type { CanvasItem } from '../ai/canvasItems'
import {
  canShareFile,
  idBlock,
  isEmptyDoc,
  parseSealed,
  readInto,
  sharedOf,
  sharedSeq,
  writeDiff
} from './doc'

const note = (id: string, text: string, x = 0): CanvasNote => ({
  id,
  text,
  color: 0,
  x,
  y: 0,
  w: 160,
  h: 120
})
const card = (id: number, url: string): CanvasCard => ({
  id,
  url,
  x: 0,
  y: 0,
  frame: null,
  manual: true,
  private: false
})
const item = (url: string): CanvasItem => ({ kind: 'page', url, title: url, site: 'example.com' })

function board(): CanvasState {
  const s = emptyState('boot')
  return {
    ...s,
    seq: 20,
    notes: [note('n1', 'one'), note('n2', 'two', 200)],
    frames: [{ id: 'f3', name: 'Ideas', kind: 'user', pinned: true, x: 0, y: 0, w: 600, h: 400 }],
    // a tab's card (id 7) and a content card (-4) with its item
    cards: [card(7, 'https://tab.example/'), card(-4, 'https://link.example/')],
    items: { '-4': item('https://link.example/') },
    connectors: [
      {
        id: 'k5',
        from: { kind: 'note', id: 'n1' },
        to: { kind: 'card', id: -4 },
        shape: 'curved',
        heads: 'end',
        label: ''
      },
      {
        id: 'k6',
        from: { kind: 'note', id: 'n2' },
        to: { kind: 'card', id: 7 },
        shape: 'curved',
        heads: 'end',
        label: ''
      }
    ],
    marks: []
  }
}

/** Two people's documents, joined: every update one makes reaches the other. */
function pair(): [Y.Doc, Y.Doc] {
  const a = new Y.Doc()
  const b = new Y.Doc()
  a.on(
    'update',
    (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(b, u, 'remote')
  )
  b.on(
    'update',
    (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(a, u, 'remote')
  )
  return [a, b]
}

describe('shared board document', () => {
  test('what is shared: notes, sections, content cards and arrows between them; never a tab or an arrow to it', () => {
    const s = sharedOf(board())
    expect([...s.notes.keys()]).toEqual(['n1', 'n2'])
    expect([...s.cards.keys()]).toEqual(['-4'])
    expect([...s.connectors.keys()]).toEqual(['k5'])
  })

  test('round trip: another person gets the shared board, and keeps their own tabs', () => {
    const [a, b] = pair()
    writeDiff(a, null, board())
    const theirs: CanvasState = {
      ...emptyState('other'),
      cards: [card(99, 'https://mine.example/')]
    }
    const got = readInto(b, theirs)
    expect(got.notes.map((n) => n.text)).toEqual(['one', 'two'])
    expect(got.frames.map((f) => f.name)).toEqual(['Ideas'])
    expect(got.cards.map((c) => c.id).sort((x, y) => x - y)).toEqual([-4, 99])
    expect(got.items['-4']?.url).toBe('https://link.example/')
    expect(got.connectors?.map((k) => k.id)).toEqual(['k5'])
    expect(got.boot).toBe('other') // their own run, not the sharer's
  })

  test('an edit to one note sends that note only, and nothing at all when nothing changed', () => {
    const doc = new Y.Doc()
    const s0 = board()
    writeDiff(doc, null, s0)
    let updates = 0
    doc.on('update', () => updates++)
    writeDiff(doc, s0, { ...s0 })
    expect(updates).toBe(0)
    const s1 = { ...s0, notes: [s0.notes[0], { ...s0.notes[1], text: 'two!' }] }
    writeDiff(doc, s0, s1)
    expect(updates).toBe(1)
    expect(readInto(doc, emptyState()).notes[1].text).toBe('two!')
  })

  test('two people editing different things at once both keep their change', () => {
    const [a, b] = pair()
    const s0 = board()
    writeDiff(a, null, s0)
    // cut the link, edit on both sides, then join again
    const a2 = new Y.Doc()
    const b2 = new Y.Doc()
    Y.applyUpdate(a2, Y.encodeStateAsUpdate(a))
    Y.applyUpdate(b2, Y.encodeStateAsUpdate(b))
    writeDiff(a2, s0, { ...s0, notes: [{ ...s0.notes[0], x: 500 }, s0.notes[1]] })
    writeDiff(b2, s0, { ...s0, notes: [s0.notes[0], { ...s0.notes[1], text: 'edited' }] })
    Y.applyUpdate(a2, Y.encodeStateAsUpdate(b2))
    Y.applyUpdate(b2, Y.encodeStateAsUpdate(a2))
    for (const d of [a2, b2]) {
      const notes = readInto(d, emptyState()).notes
      expect(notes[0].x).toBe(500)
      expect(notes[1].text).toBe('edited')
    }
  })

  test('a delete reaches the other side, and the order of what is on top holds', () => {
    const [a, b] = pair()
    const s0 = board()
    writeDiff(a, null, s0)
    const s1 = { ...s0, notes: [s0.notes[1], s0.notes[0]] } // n1 brought to the top
    writeDiff(a, s0, s1)
    expect(readInto(b, emptyState()).notes.map((n) => n.id)).toEqual(['n2', 'n1'])
    writeDiff(a, s1, { ...s1, notes: [s1.notes[0]] })
    expect(readInto(b, emptyState()).notes.map((n) => n.id)).toEqual(['n2'])
  })

  test('an empty document is known as one', () => {
    const doc = new Y.Doc()
    expect(isEmptyDoc(doc)).toBe(true)
    writeDiff(doc, null, board())
    expect(isEmptyDoc(doc)).toBe(false)
  })

  test('each person counts ids in a block of their own', () => {
    const a = idBlock(123456789)
    const b = idBlock(987654321)
    expect(a).not.toBe(b)
    expect(Math.abs(a - b)).toBeGreaterThanOrEqual(2 ** 24)
    expect(Number.isSafeInteger(idBlock(2 ** 32 - 1) + 2 ** 24)).toBe(true)
    expect(sharedSeq(20, 123456789)).toBe(a) // a local board's counter moves into the block
    expect(sharedSeq(a + 5, 123456789)).toBe(a + 5) // and stays where it got to
  })
})

describe('files of this computer on a shared board', () => {
  const path = 'C:/Users/ana/AppData/Panes/canvas-files/abc123.png'
  const pic: CanvasItem = {
    kind: 'image',
    url: 'file:///C:/Users/ana/AppData/Panes/canvas-files/abc123.png',
    title: 'holiday.png',
    site: 'This computer',
    file: path
  }
  const SEALED = 'AAAAAAAAAAAA.BBBBBBBBBBBB/.png'
  const withPic = (shared: boolean): CanvasState => ({
    ...emptyState('a'),
    cards: [{ ...card(-9, pic.url), shared }],
    items: { '-9': pic }
  })
  const pair = (): [Y.Doc, Y.Doc] => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    a.on('update', (u: Uint8Array, o: unknown) => o !== 'b' && Y.applyUpdate(b, u, 'a'))
    b.on('update', (u: Uint8Array, o: unknown) => o !== 'a' && Y.applyUpdate(a, u, 'b'))
    return [a, b]
  }
  const out = (
    sealed: string | null
  ): { by: string; title: () => string; files: () => string | null } => ({
    by: 'ana',
    title: () => '',
    files: () => sealed
  })

  test('stay home until shared, and the sharer keeps them on their own board', () => {
    const [a, b] = pair()
    writeDiff(a, null, withPic(false), undefined, out(SEALED))
    expect(readInto(b, emptyState('x'), 'ben').cards).toHaveLength(0)
    const mine = readInto(a, withPic(false), 'ana')
    expect(mine.cards.map((c) => c.id)).toEqual([-9])
    expect(mine.items['-9']).toEqual(pic)
  })

  test('shared: nothing goes until the file is in the room, and the sharer keeps the card meanwhile', () => {
    const [a, b] = pair()
    writeDiff(a, null, withPic(true), undefined, out(null))
    expect(readInto(b, emptyState('x'), 'ben').cards).toHaveLength(0)
    expect(readInto(a, withPic(true), 'ana').cards.map((c) => c.id)).toEqual([-9])
  })

  test('once sealed: no path of the sharer goes; the other gets their own copy when it is here', () => {
    const [a, b] = pair()
    writeDiff(a, null, withPic(true), undefined, out(SEALED))
    const sent = JSON.stringify(a.getMap('cards').toJSON())
    expect(sent).not.toContain('Users')
    expect(sent).not.toContain('file:///')
    const before = readInto(b, emptyState('x'), 'ben')
    expect(before.items['-9']).toMatchObject({ sealed: SEALED, kind: 'image' })
    expect(before.items['-9'].file).toBeUndefined()
    const copy = 'D:/ben/canvas-files/ff.png'
    const after = readInto(b, emptyState('x'), 'ben', undefined, (s) =>
      s === SEALED ? copy : undefined
    )
    expect(after.items['-9']).toMatchObject({ file: copy, sealed: SEALED })
    // the sharer's own board keeps their file, not the room's copy
    expect(readInto(a, withPic(true), 'ana').items['-9']).toEqual(pic)
  })

  test("the other moving it writes it back sealed, never with their copy's path", () => {
    const [a, b] = pair()
    writeDiff(a, null, withPic(true), undefined, out(SEALED))
    const seen = readInto(b, emptyState('x'), 'ben', undefined, () => 'D:/ben/canvas-files/ff.png')
    const moved = { ...seen, cards: seen.cards.map((c) => ({ ...c, x: 500 })) }
    writeDiff(b, seen, moved)
    const back = JSON.stringify(b.getMap('cards').toJSON())
    expect(back).not.toContain('ben')
    expect(readInto(a, withPic(true), 'ana').cards[0].x).toBe(500)
  })

  test('stopping sharing takes it from the others', () => {
    const [a, b] = pair()
    writeDiff(a, null, withPic(true), undefined, out(SEALED))
    writeDiff(a, withPic(true), withPic(false), undefined, out(SEALED))
    expect(readInto(b, emptyState('x'), 'ben').cards).toHaveLength(0)
  })

  test('parseSealed takes store ids and a picture or PDF extension only', () => {
    expect(parseSealed(SEALED)).toEqual({ ids: ['AAAAAAAAAAAA', 'BBBBBBBBBBBB'], ext: '.png' })
    expect(parseSealed('AAAAAAAAAAAA/.pdf')?.ext).toBe('.pdf')
    for (const bad of [
      'AAAAAAAAAAAA/.svg',
      'AAAAAAAAAAAA/.html',
      'AAAAAAAAAAAA/.exe',
      '../../x/.png',
      'short/.png',
      'AAAAAAAAAAAA/..png',
      'AAAAAAAAAAAA'
    ])
      expect(parseSealed(bad)).toBeNull()
  })

  test('canShareFile: own pictures and PDFs only', () => {
    expect(canShareFile(pic)).toBe(true)
    expect(canShareFile({ ...pic, file: 'C:/a/b.svg' })).toBe(false)
    expect(canShareFile({ ...pic, sealed: SEALED })).toBe(false)
    expect(canShareFile(item('https://x.example/a.png'))).toBe(false)
  })
})
