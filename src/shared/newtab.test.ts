import { describe, expect, test } from 'bun:test'
import { continueReading, habits, looksLikeArticle, pickBoards, type BoardLink } from './newtab'
import type { HistoryEntry } from './types'

const H = 3600_000
const D = 24 * H
// a fixed local time: 10:00 on some day
const NOW = new Date(2026, 10, 9, 10, 0, 0).getTime()
let id = 0
const visit = (url: string, time: number, title = 'T'): HistoryEntry => ({
  id: ++id,
  url,
  title,
  favicon: null,
  time
})

describe('looksLikeArticle', () => {
  test.each([
    ['https://blog.example.com/2026/11/how-to-read-faster', true],
    ['https://en.wikipedia.org/wiki/Speed_reading', true],
    ['https://example.com/posts/a3f9c0b2d1e8f7a6b5c4d3e2f1.html', true],
    ['https://example.com/', false],
    ['https://example.com/about', false],
    ['https://www.google.com/search?q=how-to-read-fast', false],
    ['https://example.com/results/long-hyphenated-thing', false],
    ['panes://history', false],
    ['not a url', false]
  ])('%s', (url, want) => expect(looksLikeArticle(url)).toBe(want))
})

describe('continueReading', () => {
  const a = 'https://news.example.com/a-long-story-here'
  const b = 'https://news.example.com/another-long-story'
  const c = 'https://news.example.com/the-third-story-now'
  test('newest first, deduped, open and old pages left out', () => {
    const h = [
      visit(a, NOW - 2 * H),
      visit(a + '#part2', NOW - H),
      visit(b, NOW - 3 * H),
      visit(c, NOW - 8 * D),
      visit('https://example.com/', NOW - 10)
    ]
    expect(continueReading(h, [], NOW).map((p) => p.url)).toEqual([a + '#part2', b])
    expect(continueReading(h, [b + '/'], NOW).map((p) => p.url)).toEqual([a + '#part2'])
  })
  test('error pages are not articles to go back to', () => {
    expect(continueReading([visit(a, NOW - H, '404 Page not found')], [], NOW)).toEqual([])
  })
  test('at most three', () => {
    const h = [1, 2, 3, 4, 5].map((i) => visit(`https://x.com/story-number-${i}-here`, NOW - i * H))
    expect(continueReading(h, [], NOW)).toHaveLength(3)
  })
  test('falls back to the address for an empty title', () => {
    expect(continueReading([visit(a, NOW - H, '')], [], NOW)[0].title).toBe(a)
  })
})

describe('habits', () => {
  const at = (
    daysAgo: number,
    hour: number,
    url = 'https://github.com/notifications'
  ): HistoryEntry => visit(url, new Date(2026, 10, 9 - daysAgo, hour, 15).getTime())
  test('a site opened around this hour on three earlier days', () => {
    const h = [at(1, 10), at(2, 9), at(4, 10)]
    const r = habits(h, [], NOW)
    expect(r).toHaveLength(1)
    expect(r[0].reason).toBe('You often open github.com around now')
    expect(r[0].url).toBe('https://github.com/notifications')
  })
  test('two days is not a habit; other hours do not count', () => {
    expect(habits([at(1, 10), at(2, 10), at(3, 16)], [], NOW)).toEqual([])
  })
  test('not when already opened today or open now', () => {
    const h = [at(1, 10), at(2, 10), at(3, 10)]
    expect(habits([...h, visit('https://github.com/', NOW - H)], [], NOW)).toEqual([])
    expect(habits(h, ['https://github.com/x'], NOW)).toEqual([])
  })
  test('older than two weeks does not count', () => {
    expect(habits([at(15, 10), at(16, 10), at(17, 10)], [], NOW)).toEqual([])
  })
  test('the most regular first, at most two', () => {
    const h = [
      ...[1, 2, 3].map((d) => at(d, 10, 'https://a.com/')),
      ...[1, 2, 3, 4].map((d) => at(d, 10, 'https://b.com/')),
      ...[1, 2, 3, 4, 5].map((d) => at(d, 10, 'https://c.com/'))
    ]
    expect(habits(h, [], NOW).map((s) => s.url)).toEqual(['https://c.com/', 'https://b.com/'])
  })
})

describe('pickBoards', () => {
  const b = (spaceId: number, things: number): BoardLink => ({
    spaceId,
    name: `S${spaceId}`,
    color: '#000',
    things
  })
  test('empty boards left out, the active space first', () => {
    expect(pickBoards([b(1, 2), b(2, 0), b(3, 5)], 3).map((x) => x.spaceId)).toEqual([3, 1])
  })
  test('then the most recently used; boards saved before stamps go last, in space order', () => {
    const list = [
      b(1, 1),
      { ...b(2, 1), usedAt: 100 },
      { ...b(3, 1), usedAt: 300 },
      b(4, 1),
      { ...b(5, 1), usedAt: 200 }
    ]
    expect(pickBoards(list, 9).map((x) => x.spaceId)).toEqual([3, 5, 2, 1])
    expect(pickBoards(list, 4).map((x) => x.spaceId)).toEqual([4, 3, 5, 2])
  })
})
