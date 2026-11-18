import { describe, expect, test } from 'bun:test'
import { Lru } from './lru'

describe('Lru', () => {
  test('the oldest goes once over budget', () => {
    const gone: string[] = []
    const l = new Lru<string, number>(2, (k) => gone.push(k))
    l.set('a', 1)
    l.set('b', 2)
    l.set('c', 3)
    expect(gone).toEqual(['a'])
    expect(l.has('b') && l.has('c')).toBe(true)
  })
  test('get makes it the newest; peek does not', () => {
    const l = new Lru<string, number>(2)
    l.set('a', 1)
    l.set('b', 2)
    l.get('a')
    l.set('c', 3)
    expect(l.has('a')).toBe(true)
    expect(l.has('b')).toBe(false)
    l.peek('a')
    l.set('d', 4)
    expect(l.has('a')).toBe(false)
  })
  test('weights count against the budget; the newest stays however heavy', () => {
    const l = new Lru<string, number>(10)
    l.set('a', 1, 4)
    l.set('b', 2, 4)
    l.set('c', 3, 4)
    expect([l.has('a'), l.has('b'), l.has('c')]).toEqual([false, true, true])
    expect(l.weight).toBe(8)
    l.set('huge', 0, 50)
    expect(l.size).toBe(1)
    expect(l.has('huge')).toBe(true)
  })
  test('replacing a value evicts the old one, the same one does not', () => {
    const gone: number[] = []
    const l = new Lru<string, number>(5, (_k, v) => gone.push(v))
    l.set('a', 1)
    l.set('a', 1)
    l.set('a', 2)
    expect(gone).toEqual([1])
    expect(l.weight).toBe(1)
    l.delete('a')
    expect(gone).toEqual([1, 2])
    expect(l.size).toBe(0)
  })
})
