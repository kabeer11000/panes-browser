import { describe, expect, test } from 'bun:test'
import { splitShortcut } from './tooltipText'

describe('splitShortcut', () => {
  test('a trailing key becomes keys', () => {
    expect(splitShortcut('Pen (P)')).toEqual({ text: 'Pen', keys: ['P'] })
    expect(splitShortcut('Tidy (Shift+T)')).toEqual({ text: 'Tidy', keys: ['Shift', 'T'] })
    expect(splitShortcut('Find (/)')).toEqual({ text: 'Find', keys: ['/'] })
  })
  test('words in brackets stay words', () => {
    expect(splitShortcut('Hand (or hold Space)').keys).toEqual([])
    expect(splitShortcut('Section (or Alt and drag)').text).toBe('Section (or Alt and drag)')
    expect(splitShortcut('Settings')).toEqual({ text: 'Settings', keys: [] })
  })
})
