import { describe, expect, test } from 'bun:test'
import { qrBitmap } from './qr'

describe('qrBitmap', () => {
  test('square, quiet zone white, finder pattern dark in the corner', () => {
    const { width, height, bgra } = qrBitmap('https://example.com/', 4, 4)
    expect(width).toBe(height)
    const px = (x: number, y: number): number => bgra[(y * width + x) * 4]
    expect(px(0, 0)).toBe(255) // quiet zone
    expect(px(16, 16)).toBe(0) // the finder's top-left module, just inside the margin
    expect(px(16 + 4, 16 + 4)).toBe(255) // the finder's white ring
    expect(bgra[3]).toBe(255) // opaque
  })
  test('a longer address takes a bigger code', () => {
    const short = qrBitmap('https://a.io/', 1, 0).width
    const long = qrBitmap('https://example.com/' + 'x'.repeat(200), 1, 0).width
    expect(long).toBeGreaterThan(short)
  })
})
