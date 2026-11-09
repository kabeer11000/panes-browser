import { describe, expect, test } from 'bun:test'
import { matchCommands } from './canvasCommands'

const list = [
  { id: 'note', label: 'New note', also: 'sticky' },
  { id: 'frame', label: 'New section', also: 'frame' },
  { id: 'tidy', label: 'Tidy up', also: 'arrange sort' },
  { id: 'table', label: 'Table' },
  { id: 'export', label: 'Export as image' }
]
const ids = (q: string): string[] => matchCommands(q, list).map((c) => c.id)

describe('matchCommands', () => {
  test('nothing typed: all, in order', () => {
    expect(ids('')).toEqual(['note', 'frame', 'tidy', 'table', 'export'])
  })
  test('every word must start a word of the label or its other names', () => {
    expect(ids('frame')).toEqual(['frame'])
    expect(ids('new')).toEqual(['note', 'frame'])
    expect(ids('new sec')).toEqual(['frame'])
    expect(ids('ote')).toEqual([])
  })
  test('the label first, then other names', () => {
    expect(ids('t')).toEqual(['tidy', 'table'])
    expect(ids('st')).toEqual(['note'])
    expect(ids('so')).toEqual(['tidy'])
  })
})
