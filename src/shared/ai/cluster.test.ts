import { describe, expect, test } from 'bun:test'
import { agglomerative, cosine, topK } from './cluster'

const near = (x: number, y: number): number[] => [x, y, 0, 0]
const far = (x: number): number[] => [0, 0, 1, x]

describe('cosine and topK', () => {
  test('cosine', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1)
    expect(cosine([0, 0], [1, 0])).toBe(0)
  })

  test('topK orders by score, honours k and the floor', () => {
    const items = [
      [0, 1],
      [1, 0.1],
      [1, 0],
      [0.7, 0.7]
    ]
    expect(topK([1, 0], items, 2).map((o) => o.index)).toEqual([2, 1])
    expect(topK([1, 0], items, 10, 0.5).map((o) => o.index)).toEqual([2, 1, 3])
  })
})

describe('agglomerative', () => {
  test('identical vectors cluster', () => {
    expect(
      agglomerative([
        [1, 0],
        [1, 0],
        [1, 0]
      ])
    ).toEqual([[0, 1, 2]])
  })

  test('orthogonal vectors do not', () => {
    expect(
      agglomerative([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ])
    ).toEqual([])
  })

  test('two topics make two clusters, in order of first member', () => {
    const v = [near(1, 0.1), far(0.1), near(1, 0.2), far(0.2), near(1, 0), far(0)]
    expect(agglomerative(v)).toEqual([
      [0, 2, 4],
      [1, 3, 5]
    ])
  })

  test('groups smaller than the minimum are dropped', () => {
    const v = [near(1, 0), near(1, 0.05), far(0)]
    expect(agglomerative(v)).toEqual([])
    expect(agglomerative(v, 0.75, 2)).toEqual([[0, 1]])
  })

  test('the same input gives the same answer', () => {
    const v = [near(1, 0.1), near(1, 0.2), near(1, 0), far(0), far(0.1), far(0.2)]
    expect(agglomerative(v)).toEqual(agglomerative(v))
  })

  test('empty and single inputs', () => {
    expect(agglomerative([])).toEqual([])
    expect(agglomerative([[1, 0]])).toEqual([])
  })
})
