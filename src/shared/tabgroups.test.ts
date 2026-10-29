import { describe, expect, test } from 'bun:test'
import {
  GROUP_COLORS,
  groupAfterMove,
  groupForSlot,
  nextGroupColor,
  placeInGroup,
  sanitizeGroupPatch
} from './tabgroups'

const of = (m: Record<number, number>) => (id: number) => m[id] ?? null

describe('placeInGroup', () => {
  test('moves the tab to just after the last member', () => {
    const groupOf = of({ 1: 7, 3: 7 })
    expect(placeInGroup([1, 2, 3, 4, 5], groupOf, 5, 7)).toEqual([1, 2, 3, 5, 4])
    expect(placeInGroup([1, 2, 3, 4, 5], groupOf, 2, 7)).toEqual([1, 3, 2, 4, 5])
  })

  test('leaves the order alone when the group has no other member', () => {
    expect(placeInGroup([1, 2, 3], of({ 2: 7 }), 2, 7)).toEqual([1, 2, 3])
  })
})

describe('groupAfterMove', () => {
  test('joins a group when dropped between two of its tabs', () => {
    expect(groupAfterMove([1, 9, 2], of({ 1: 7, 2: 7 }), 9)).toBe(7)
  })

  test('keeps its group while it still touches it, leaves otherwise', () => {
    expect(groupAfterMove([1, 2, 5], of({ 1: 7, 2: 7 }), 2)).toBe(7)
    expect(groupAfterMove([5, 3, 1], of({ 1: 7, 3: 7 }), 3)).toBe(7)
    expect(groupAfterMove([5, 6, 3, 1], of({ 3: 7, 1: 7 }), 3)).toBe(7)
    expect(groupAfterMove([3, 5, 6], of({ 3: 7 }), 5)).toBeNull()
    expect(groupAfterMove([3, 5, 6, 1], of({ 3: 7, 1: 7 }), 3)).toBeNull()
  })

  test('a lone tab dragged away from its group is ungrouped', () => {
    expect(groupAfterMove([5, 8, 1, 2], of({ 1: 7, 2: 7, 5: 7 }), 5)).toBeNull()
  })

  test('unknown tab gives none', () => {
    expect(groupAfterMove([1], of({}), 99)).toBeNull()
  })
})

describe('colours and patches', () => {
  test('nextGroupColor takes the first unused colour, then cycles', () => {
    expect(nextGroupColor([])).toBe(GROUP_COLORS[0])
    expect(nextGroupColor([GROUP_COLORS[0]])).toBe(GROUP_COLORS[1])
    expect(nextGroupColor([...GROUP_COLORS])).toBe(GROUP_COLORS[0])
  })

  test('sanitizeGroupPatch keeps only well-formed fields', () => {
    expect(
      sanitizeGroupPatch({ name: '  Work  ', color: '#112233', collapsed: true, evil: 1 })
    ).toEqual({
      name: 'Work',
      color: '#112233',
      collapsed: true
    })
    expect(sanitizeGroupPatch({ color: 'red', name: 5, collapsed: 'yes' })).toEqual({})
    expect(sanitizeGroupPatch(null)).toEqual({})
    expect(sanitizeGroupPatch({ name: 'x'.repeat(100) }).name?.length).toBe(32)
  })
})

describe('groupForSlot', () => {
  test('between two tabs of one group it is that group, wherever the pointer is', () => {
    expect(groupForSlot(4, 4, null)).toBe(4)
  })
  test('at a group edge the pointer over the group joins it and past it leaves', () => {
    expect(groupForSlot(4, null, 'before')).toBe(4)
    expect(groupForSlot(4, null, null)).toBeNull()
    expect(groupForSlot(null, 4, 'after')).toBe(4)
    expect(groupForSlot(null, 4, null)).toBeNull()
  })
  test('between two different groups, the neighbour the pointer is over wins', () => {
    expect(groupForSlot(4, 5, 'before')).toBe(4)
    expect(groupForSlot(4, 5, 'after')).toBe(5)
    expect(groupForSlot(4, 5, null)).toBeNull()
  })
  test('among loose tabs there is no group', () => {
    expect(groupForSlot(null, null, null)).toBeNull()
  })
})
