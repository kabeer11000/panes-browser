import { describe, expect, test } from 'bun:test'
import { prunePlan, type SavedPage } from './savedPages'

const p = (at: number, bytes: number): SavedPage => ({ file: `${at}.mhtml`, at, bytes, y: 0 })

describe('prunePlan', () => {
  test('pages no tab holds any more go', () => {
    expect(prunePlan({ a: p(1, 10), b: p(2, 10) }, new Set(['b']))).toEqual(['a'])
  })

  test('over the budget, the oldest of the kept ones go until the rest fit', () => {
    const saved = { a: p(3, 40), b: p(1, 40), c: p(2, 40) }
    expect(prunePlan(saved, new Set(['a', 'b', 'c']), 100)).toEqual(['b'])
    expect(prunePlan(saved, new Set(['a', 'b', 'c']), 50)).toEqual(['b', 'c'])
    expect(prunePlan(saved, new Set(['a', 'b', 'c']), 200)).toEqual([])
  })
})
