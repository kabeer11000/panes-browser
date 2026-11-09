import { describe, expect, test } from 'bun:test'
import {
  fallbackName,
  GroupSuggestionState,
  type GroupTab,
  nameFromReply,
  planGroups,
  sanitizeGroupName,
  SUGGEST_INTERVAL_MS
} from './grouping'

const tab = (id: number, vec: number[]): GroupTab => ({ id, url: 'u', title: '', vec })

describe('planGroups', () => {
  test('returns tab ids, one set per topic', () => {
    const tabs = [
      tab(10, [1, 0.1, 0]),
      tab(11, [0, 0.1, 1]),
      tab(12, [1, 0.2, 0]),
      tab(13, [0, 0.2, 1]),
      tab(14, [1, 0, 0]),
      tab(15, [0, 0, 1])
    ]
    expect(planGroups(tabs)).toEqual([
      [10, 12, 14],
      [11, 13, 15]
    ])
  })
})

describe('fallbackName', () => {
  test('most common site', () => {
    expect(
      fallbackName(['https://www.github.com/a', 'https://github.com/b', 'https://example.org/'])
    ).toBe('Github')
  })
  test('no usable url', () => {
    expect(fallbackName(['nope'])).toBe('Tabs')
    expect(fallbackName([])).toBe('Tabs')
  })
})

describe('group names from a model', () => {
  test('at most three words, one line, no quotes', () => {
    expect(sanitizeGroupName('"Tokyo trip planning for may"\nmore')).toBe('Tokyo trip planning')
  })
  test('unusable', () => {
    expect(sanitizeGroupName('')).toBeNull()
    expect(sanitizeGroupName(3)).toBeNull()
  })
  test('from a JSON reply', () => {
    expect(nameFromReply('{"name": "Tokyo trip"}')).toBe('Tokyo trip')
    expect(nameFromReply('nothing')).toBeNull()
  })
})

describe('GroupSuggestionState', () => {
  test('needs six ungrouped tabs', () => {
    const s = new GroupSuggestionState()
    expect(s.due(1, 5, 0)).toBe(false)
    expect(s.due(1, 6, 0)).toBe(true)
  })

  test('once per two minutes per space', () => {
    const s = new GroupSuggestionState()
    s.markRun(1, 1000)
    expect(s.due(1, 9, 1000 + SUGGEST_INTERVAL_MS - 1)).toBe(false)
    expect(s.due(1, 9, 1000 + SUGGEST_INTERVAL_MS)).toBe(true)
    expect(s.due(2, 9, 1001)).toBe(true)
  })

  test('a dismissed set, and any part of it, is not suggested again', () => {
    const s = new GroupSuggestionState()
    s.dismiss(1, [1, 2, 3, 4])
    expect(s.isDismissed(1, [1, 2, 3, 4])).toBe(true)
    expect(s.isDismissed(1, [4, 3, 2])).toBe(true)
    expect(s.isDismissed(1, [1, 2, 3, 4, 5])).toBe(false)
    expect(s.isDismissed(2, [1, 2, 3, 4])).toBe(false)
    expect(
      s.remaining(1, [
        [1, 2, 3],
        [7, 8, 9]
      ])
    ).toEqual([[7, 8, 9]])
  })
})
