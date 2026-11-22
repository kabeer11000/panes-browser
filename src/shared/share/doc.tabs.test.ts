import { describe, expect, test } from 'bun:test'
import * as Y from 'yjs'
import { emptyState, type CanvasCard, type CanvasState } from '../ai/canvas'
import { isMirror, mirrorId, readInto, writeDiff } from './doc'

const card = (id: number, url: string, x = 0, extra: Partial<CanvasCard> = {}): CanvasCard => ({
  id,
  url,
  x,
  y: 0,
  frame: 'f1',
  manual: true,
  private: false,
  ...extra
})
const withCards = (cards: CanvasCard[]): CanvasState => ({ ...emptyState('b'), cards })
const titles = (id: number): string => `Tab ${id}`

/** Two people's documents, joined both ways. */
function pair(): [Y.Doc, Y.Doc] {
  const a = new Y.Doc()
  const b = new Y.Doc()
  a.on('update', (u: Uint8Array, o: unknown) => o !== 'b' && Y.applyUpdate(b, u, 'a'))
  b.on('update', (u: Uint8Array, o: unknown) => o !== 'a' && Y.applyUpdate(a, u, 'b'))
  return [a, b]
}

describe('tabs shared as mirrors', () => {
  test("a person's tabs show on the other's board where they are, as pages, never as their own tabs", () => {
    const [a, b] = pair()
    const mine = withCards([card(7, 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', 40), card(8, 'https://example.com/', 300)])
    writeDiff(a, null, mine, undefined, { by: 'ana', title: titles })
    const theirs = readInto(b, emptyState('x'), 'ben')
    expect(theirs.cards).toHaveLength(2)
    for (const c of theirs.cards) expect(isMirror(c.id)).toBe(true)
    const yt = theirs.cards.find((c) => c.url.includes('youtube'))!
    expect([yt.x, yt.frame]).toEqual([40, 'f1'])
    expect(theirs.items[String(yt.id)]).toMatchObject({ kind: 'video', title: 'Tab 7', source: 'tab' })
    // the owner's own board is untouched by them
    expect(readInto(a, mine, 'ana').cards.map((c) => c.id)).toEqual([7, 8])
  })

  test('private tabs and non-web pages never leave', () => {
    const [a, b] = pair()
    const mine = withCards([
      card(7, 'https://secret.example/', 0, { private: true }),
      card(8, 'panes://settings'),
      card(9, 'https://ok.example/')
    ])
    writeDiff(a, null, mine, undefined, { by: 'ana', title: titles })
    expect(readInto(b, emptyState('x'), 'ben').cards.map((c) => c.url)).toEqual(['https://ok.example/'])
  })

  test('a move, a close and a restart (new tab ids) reach the other, with no leftovers', () => {
    const [a, b] = pair()
    const one = withCards([card(7, 'https://a.example/'), card(8, 'https://b.example/')])
    writeDiff(a, null, one, undefined, { by: 'ana', title: titles })
    const moved = withCards([card(7, 'https://a.example/', 500)])
    writeDiff(a, one, moved, undefined, { by: 'ana', title: titles })
    let theirs = readInto(b, emptyState('x'), 'ben')
    expect(theirs.cards.map((c) => [c.url, c.x])).toEqual([['https://a.example/', 500]])
    // Panes started again: the same page is tab 3 now, and the board it saves from never had tab 7
    writeDiff(a, emptyState('b'), withCards([card(3, 'https://a.example/', 500)]), undefined, { by: 'ana', title: titles })
    theirs = readInto(b, theirs, 'ben')
    expect(theirs.cards).toHaveLength(1)
  })

  test("someone else's mirrors are never written back as content of their own", () => {
    const [a, b] = pair()
    writeDiff(a, null, withCards([card(7, 'https://a.example/')]), undefined, { by: 'ana', title: titles })
    const theirs = readInto(b, emptyState('x'), 'ben')
    // ben moves the mirror on his board and saves: nothing of it goes into the document as his
    const nudged = { ...theirs, cards: theirs.cards.map((c) => ({ ...c, x: 999 })) }
    writeDiff(b, theirs, nudged, undefined, { by: 'ben', title: titles })
    expect(b.getMap('cards').size).toBe(0)
    expect([...b.getMap('tabs').keys()]).toEqual(['ana:7'])
    // and a rebuild drops the stale mirror for the document's own
    expect(readInto(b, nudged, 'ben').cards.map((c) => c.x)).toEqual([0])
  })

  test('mirror ids are stable, distinct and far from content and tab ids', () => {
    expect(mirrorId('ana:7')).toBe(mirrorId('ana:7'))
    expect(mirrorId('ana:7')).not.toBe(mirrorId('ana:8'))
    expect(mirrorId('ana:7')).not.toBe(mirrorId('ben:7'))
    expect(isMirror(mirrorId('ana:7'))).toBe(true)
    expect(isMirror(-(2 ** 45))).toBe(false)
    expect(Number.isSafeInteger(mirrorId('zz'.repeat(20)))).toBe(true)
  })
})
