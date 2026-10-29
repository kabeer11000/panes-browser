import { describe, expect, test } from 'bun:test'
import { slideOffsets } from './slide'

// five rows of height 10 with a 2px gap: starts 0, 12, 24, 36, 48
const rows = Array.from({ length: 5 }, (_, i) => ({ start: i * 12, end: i * 12 + 10 }))

describe('slideOffsets', () => {
  test('dropping where it already is moves nothing', () => {
    expect(slideOffsets(rows, 2, 1, 2)).toEqual([0, 0, 0, 0, 0])
    expect(slideOffsets(rows, 2, 1, 3)).toEqual([0, 0, 0, 0, 0])
  })
  test('dragging row 1 to before row 4: rows 2 and 3 slide back, row 1 lands after them', () => {
    const o = slideOffsets(rows, 1, 1, 4)
    expect(o).toEqual([0, 24, -12, -12, 0])
  })
  test('dragging row 3 to the front: rows 0..2 slide forward, row 3 lands first', () => {
    const o = slideOffsets(rows, 3, 1, 0)
    expect(o).toEqual([12, 12, 12, -36, 0])
  })
  test('a block of two moves as one', () => {
    const o = slideOffsets(rows, 0, 2, 4) // rows 0,1 to before row 4
    expect(o).toEqual([24, 24, -24, -24, 0])
  })
  test('to the very end', () => {
    expect(slideOffsets(rows, 0, 1, 5)).toEqual([48, -12, -12, -12, -12])
  })
})
