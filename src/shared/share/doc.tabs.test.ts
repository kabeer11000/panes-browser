import { describe, expect, test } from 'bun:test'
import * as Y from 'yjs'
import { emptyState, type CanvasCard, type CanvasState } from '../ai/canvas'
import { isMirror, mirrorId, readInto, samePage, withTabs, writeDiff } from './doc'

const card = (id: number, url: string, x = 0, extra: Partial<CanvasCard> = {}): CanvasCard => ({
  id,
  url,
  x,
  y: 0,
  frame: 'f1',
  manual: true,
  private: false,
  shared: true, // the person shared it (tabs are private until shared: see 'tabs are private until shared')
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
    const mine = withCards([
      card(7, 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', 40),
      card(8, 'https://example.com/', 300)
    ])
    writeDiff(a, null, mine, undefined, { by: 'ana', title: titles })
    const theirs = readInto(b, emptyState('x'), 'ben')
    expect(theirs.cards).toHaveLength(2)
    for (const c of theirs.cards) expect(isMirror(c.id)).toBe(true)
    const yt = theirs.cards.find((c) => c.url.includes('youtube'))!
    expect([yt.x, yt.frame]).toEqual([40, 'f1'])
    expect(theirs.items[String(yt.id)]).toMatchObject({
      kind: 'video',
      title: 'Tab 7',
      source: 'tab'
    })
    // the owner's own board is untouched by them
    expect(readInto(a, mine, 'ana').cards.map((c) => c.id)).toEqual([7, 8])
  })

  test("someone else's tab never sits on top of one of this person's own (same slot): it moves beside", () => {
    const [a, b] = pair()
    writeDiff(a, null, withCards([card(7, 'https://a.example/', 40)]), undefined, {
      by: 'ana',
      title: titles
    })
    // Ben's own tab is in the very same spot
    const bens = withCards([card(3, 'https://b.example/', 40)])
    const seen = readInto(b, bens, 'ben')
    const own = seen.cards.find((c) => c.id === 3)!
    const theirs = seen.cards.find((c) => isMirror(c.id))!
    expect([own.x, own.y]).toEqual([40, 0])
    const apart =
      theirs.x >= own.x + 240 ||
      theirs.x + 240 <= own.x ||
      theirs.y >= own.y + 300 ||
      theirs.y + 300 <= own.y
    expect(apart).toBe(true)
    // the same answer each time it is read (no drifting from one sync to the next)
    const again = readInto(b, bens, 'ben').cards.find((c) => isMirror(c.id))!
    expect([again.x, again.y]).toEqual([theirs.x, theirs.y])
  })

  test('private tabs and non-web pages never leave', () => {
    const [a, b] = pair()
    const mine = withCards([
      card(7, 'https://secret.example/', 0, { private: true }),
      card(8, 'panes://settings'),
      card(9, 'https://ok.example/')
    ])
    writeDiff(a, null, mine, undefined, { by: 'ana', title: titles })
    expect(readInto(b, emptyState('x'), 'ben').cards.map((c) => c.url)).toEqual([
      'https://ok.example/'
    ])
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
    writeDiff(a, emptyState('b'), withCards([card(3, 'https://a.example/', 500)]), undefined, {
      by: 'ana',
      title: titles
    })
    theirs = readInto(b, theirs, 'ben')
    expect(theirs.cards).toHaveLength(1)
  })

  test("someone else's mirrors are never written back as content of their own", () => {
    const [a, b] = pair()
    writeDiff(a, null, withCards([card(7, 'https://a.example/')]), undefined, {
      by: 'ana',
      title: titles
    })
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

  test("a tab's picture goes with it; the other sees it once it is here, the title card until then", () => {
    const [a, b] = pair()
    writeDiff(a, null, withCards([card(7, 'https://a.example/')]), undefined, {
      by: 'ana',
      title: titles,
      pic: (id) => (id === 7 ? 'blob7' : undefined)
    })
    const asked: string[] = []
    const before = readInto(b, emptyState('x'), 'ben', (id) => {
      asked.push(id)
      return undefined
    })
    expect(asked).toEqual(['blob7'])
    expect(before.items[String(before.cards[0].id)].image).toBeUndefined()
    const after = readInto(b, emptyState('x'), 'ben', () => 'data:image/jpeg;base64,xx')
    expect(after.items[String(after.cards[0].id)].image).toBe('data:image/jpeg;base64,xx')
  })
})

describe('a page shows once on a shared board', () => {
  test("opening someone's tab here: their mirror gives way to one's own card, on both boards", () => {
    const [a, b] = pair()
    const anas = withCards([card(7, 'https://www.youtube.com/watch?v=x#t=3', 40)])
    writeDiff(a, null, anas, undefined, { by: 'ana', title: titles })
    // Ben opened Ana's tab: a tab of his own now, same page
    const bens = withCards([card(2, 'https://youtube.com/watch?v=x', 600)])
    writeDiff(b, null, bens, undefined, { by: 'ben', title: titles })
    expect(readInto(b, bens, 'ben').cards.map((c) => c.id)).toEqual([2])
    expect(readInto(a, anas, 'ana').cards.map((c) => c.id)).toEqual([7])
  })

  test('two others with the same page: one card, the same one on every board', () => {
    const [a, b] = pair()
    writeDiff(a, null, withCards([card(1, 'https://example.com/')]), undefined, {
      by: 'ana',
      title: titles
    })
    writeDiff(a, null, withCards([card(5, 'https://example.com')]), undefined, {
      by: 'cat',
      title: titles
    })
    const seen = readInto(b, emptyState('x'), 'ben').cards
    expect(seen).toHaveLength(1)
    expect(seen[0].id).toBe(mirrorId('ana:1'))
  })

  test('samePage', () => {
    expect(samePage('https://www.A.com/p/#x')).toBe(samePage('https://a.com/p'))
    expect(samePage('https://a.com/p?q=1')).not.toBe(samePage('https://a.com/p?q=2'))
    expect(samePage('not a url')).toBe('not a url')
  })
})

test("a tab closed or moved on away from the board: the others' copy follows without the board saving", () => {
  const [a, b] = pair()
  const board = withCards([card(7, 'https://a.example/'), card(8, 'https://b.example/', 300)])
  const urls = new Map<number, string | null>([
    [7, 'https://a.example/'],
    [8, 'https://b.example/']
  ])
  const out = { by: 'ana', title: titles, url: (id: number) => urls.get(id) ?? null }
  writeDiff(a, null, board, undefined, out)
  expect(readInto(b, emptyState('x'), 'ben').cards).toHaveLength(2)
  urls.set(7, null) // closed
  urls.set(8, 'https://c.example/') // went elsewhere
  writeDiff(a, board, board, undefined, out)
  expect(readInto(b, emptyState('x'), 'ben').cards.map((c) => c.url)).toEqual([
    'https://c.example/'
  ])
})

describe('the live tab without a card yet (shown from the tab view, board never opened)', () => {
  test('reaches the others at once, after the board, overlapping nothing', () => {
    const [a, b] = pair()
    const board = withCards([card(7, 'https://a.example/', 40)])
    writeDiff(a, null, board, undefined, {
      by: 'ana',
      title: titles,
      all: () => [{ id: 9, url: 'https://new.example/' }],
      live: 9
    })
    const seen = readInto(b, emptyState('x'), 'ben')
    expect(seen.cards.map((c) => c.url).sort()).toEqual([
      'https://a.example/',
      'https://new.example/'
    ])
    const old = seen.cards.find((c) => c.url === 'https://a.example/')!
    for (const c of seen.cards.filter((x) => x !== old)) {
      expect(c.x).toBeGreaterThan(old.x)
      expect(c.frame).toBeNull()
    }
    expect(seen.items[String(seen.cards.find((c) => c.url.includes('new'))!.id)]).toMatchObject({
      title: 'Tab 9'
    })
  })

  test('the board itself is not changed, and a tab already on it is not doubled', () => {
    const board = withCards([card(7, 'https://a.example/', 40)])
    expect(withTabs(board, [{ id: 7, url: 'https://a.example/' }])).toBe(board)
    const s = withTabs(board, [
      { id: 7, url: 'https://a.example/' },
      { id: 8, url: 'https://b.example/' },
      { id: 9, url: 'https://c.example/' }
    ])
    expect(board.cards).toHaveLength(1)
    expect(s.cards.map((c) => c.id)).toEqual([7, 8, 9])
    const [, x, y] = s.cards
    expect(x.x + 240 <= y.x || y.x + 240 <= x.x || x.y + 300 <= y.y || y.y + 300 <= x.y).toBe(true)
  })

  test('pages that are not web pages stay home; an empty board starts at the origin', () => {
    const s = withTabs(emptyState('b'), [
      { id: 1, url: 'panes://settings/' },
      { id: 2, url: 'https://x.example/' }
    ])
    expect(s.cards.map((c) => [c.id, c.x, c.y])).toEqual([[2, 0, 0]])
  })

  test('a tab that closes goes from the others too', () => {
    const [a, b] = pair()
    let tabs = [{ id: 9, url: 'https://new.example/' }]
    const out = { by: 'ana', title: titles, all: () => tabs, live: 9 }
    writeDiff(a, null, emptyState('b'), undefined, out)
    expect(readInto(b, emptyState('x'), 'ben').cards).toHaveLength(1)
    tabs = []
    writeDiff(a, emptyState('b'), emptyState('b'), undefined, out)
    expect(readInto(b, emptyState('x'), 'ben').cards).toHaveLength(0)
  })
})

describe('tabs are private until shared', () => {
  test("a tab never shared and not live never reaches the others; sharing sends it, unsharing takes it back", () => {
    const [a, b] = pair()
    const priv = withCards([card(7, 'https://bank.example/', 0, { shared: false })])
    const out = { by: 'ana', title: titles, all: () => [{ id: 8, url: 'https://mail.example/' }] }
    writeDiff(a, null, priv, undefined, out)
    expect(readInto(b, emptyState('x'), 'ben').cards).toHaveLength(0)
    const shared = withCards([card(7, 'https://bank.example/', 0, { shared: true })])
    writeDiff(a, priv, shared, undefined, out)
    expect(readInto(b, emptyState('x'), 'ben').cards.map((c) => c.url)).toEqual([
      'https://bank.example/'
    ])
    writeDiff(a, shared, priv, undefined, out)
    expect(readInto(b, emptyState('x'), 'ben').cards).toHaveLength(0)
  })

  test('the live tab goes while it is live, shared or not, and leaves when the show ends', () => {
    const [a, b] = pair()
    const board = withCards([card(7, 'https://a.example/', 0, { shared: false })])
    writeDiff(a, null, board, undefined, { by: 'ana', title: titles, live: 7 })
    expect(readInto(b, emptyState('x'), 'ben').cards).toHaveLength(1)
    writeDiff(a, board, board, undefined, { by: 'ana', title: titles })
    expect(readInto(b, emptyState('x'), 'ben').cards).toHaveLength(0)
  })
})
