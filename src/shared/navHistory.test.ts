import { describe, expect, test } from 'bun:test'
import { keepHistory } from './navHistory'

const e = (n: number, scheme = 'https'): { url: string; title: string } => ({
  url: `${scheme}://site/${n}`,
  title: `p${n}`
})

describe('keepHistory', () => {
  test('keeps web pages around the current one', () => {
    expect(keepHistory([e(1), e(2), e(3)], 1)).toEqual({ entries: [e(1), e(2), e(3)], index: 1 })
  })
  test('drops internal pages and keeps the index on the current page', () => {
    const list = [e(1), { url: 'panes://newtab', title: 'New tab' }, e(2), e(3)]
    expect(keepHistory(list, 2)).toEqual({ entries: [e(1), e(2), e(3)], index: 1 })
  })
  test('a single page is kept, so it is restored (from cache, where it was) rather than loaded afresh', () => {
    expect(keepHistory([e(1)], 0)).toEqual({ entries: [e(1)], index: 0 })
  })
  test('keeps the saved page state of the current entry only, and not when it is huge', () => {
    const st = (n: number, pageState: unknown): object => ({ ...e(n), pageState })
    expect(keepHistory([st(1, 'a'), st(2, 'b')], 1)).toEqual({
      entries: [e(1), { ...e(2), pageState: 'b' }],
      index: 1
    })
    expect(keepHistory([st(1, 'x'.repeat(70_000))], 0)).toEqual({ entries: [e(1)], index: 0 })
    expect(keepHistory([st(1, 5)], 0)).toEqual({ entries: [e(1)], index: 0 })
    expect(keepHistory([st(1, '')], 0)).toEqual({ entries: [e(1)], index: 0 })
  })
  test('the current page is internal or missing: null', () => {
    expect(keepHistory([e(1), { url: 'about:blank', title: '' }], 1)).toBeNull()
    expect(keepHistory([e(1), e(2)], 5)).toBeNull()
  })
  test('caps the length, mostly behind the current page', () => {
    const list = Array.from({ length: 60 }, (_, i) => e(i))
    const h = keepHistory(list, 50, 25)!
    expect(h.entries).toHaveLength(25)
    expect(h.entries[h.index]).toEqual(e(50))
    expect(h.entries.at(-1)).toEqual(e(55))
  })
  test('rejects what is not a list read back from disk', () => {
    expect(keepHistory('x', 0)).toBeNull()
    expect(keepHistory([e(1), 5, null, e(2)], 3)).toEqual({ entries: [e(1), e(2)], index: 1 })
    expect(keepHistory([e(1), e(2)], '1')).toBeNull()
  })
})
