import { describe, expect, test } from 'bun:test'
import { dropIndex, moveId } from './order'

describe('moveId', () => {
  test('moves forward and back', () => {
    expect(moveId([1, 2, 3, 4], 1, 2)).toEqual([2, 3, 1, 4])
    expect(moveId([1, 2, 3, 4], 4, 0)).toEqual([4, 1, 2, 3])
  })
  test('clamped to the list, and the same array when nothing moves', () => {
    expect(moveId([1, 2, 3], 1, 99)).toEqual([2, 3, 1])
    expect(moveId([1, 2, 3], 3, -5)).toEqual([3, 1, 2])
    const ids = [1, 2, 3]
    expect(moveId(ids, 2, 1)).toBe(ids)
    expect(moveId(ids, 9, 0)).toBe(ids)
  })
})

describe('dropIndex', () => {
  test('before the first item whose middle is past the pointer', () => {
    expect(dropIndex([10, 30, 50], 5)).toBe(0)
    expect(dropIndex([10, 30, 50], 20)).toBe(1)
    expect(dropIndex([10, 30, 50], 60)).toBe(3)
    expect(dropIndex([], 60)).toBe(0)
  })
})
