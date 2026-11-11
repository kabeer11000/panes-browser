import { describe, expect, test } from 'bun:test'
import { badgeIcon, badgeLabel } from './badgeIcon'

const RED = [0xe5, 0x48, 0x4d] as const
const white = (buf: Uint8Array): number => {
  let n = 0
  for (let i = 0; i < buf.length; i += 4)
    if (buf[i] === 255 && buf[i + 1] === 255 && buf[i + 2] === 255) n++
  return n
}

describe('badgeLabel', () => {
  test('nothing for none, the digit up to nine, then 9+', () => {
    expect(badgeLabel(0)).toBe('')
    expect(badgeLabel(3)).toBe('3')
    expect(badgeLabel(9)).toBe('9')
    expect(badgeLabel(10)).toBe('9+')
    expect(badgeLabel(250)).toBe('9+')
  })
})

describe('badgeIcon', () => {
  test('a plain red dot with no label, transparent corners, opaque middle', () => {
    const b = badgeIcon('', RED, 16)
    expect(b.length).toBe(16 * 16 * 4)
    expect(b[3]).toBe(0) // top-left corner
    const mid = (8 * 16 + 8) * 4
    expect(b[mid + 3]).toBe(255)
    expect([b[mid + 2], b[mid + 1], b[mid]]).toEqual([...RED])
    expect(white(b)).toBe(0)
  })
  test('a digit is white ink inside the circle; 8 has more ink than 1; "9+" fits', () => {
    for (const size of [16, 32]) {
      const one = white(badgeIcon('1', RED, size))
      const eight = white(badgeIcon('8', RED, size))
      expect(one).toBeGreaterThan(0)
      expect(eight).toBeGreaterThan(one)
      expect(white(badgeIcon('9+', RED, size))).toBeGreaterThan(0)
    }
  })
})
