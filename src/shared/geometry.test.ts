import { describe, expect, test } from 'bun:test'
import { innerRect } from './geometry'

describe('innerRect', () => {
  test('whole pixels stay as they are', () => {
    expect(innerRect({ x: 10, y: 20, width: 300, height: 200 })).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200
    })
  })
  test('fractional edges snap inward, never past the box', () => {
    const r = { x: 9.6, y: 4.4, width: 400.8, height: 100.2 }
    const o = innerRect(r)
    expect(o).toEqual({ x: 10, y: 5, width: 400, height: 99 })
    expect(o.x).toBeGreaterThanOrEqual(r.x)
    expect(o.x + o.width).toBeLessThanOrEqual(r.x + r.width)
  })
  test('float noise just under a whole pixel is not lost', () => {
    expect(innerRect({ x: 9.999, y: 0, width: 100.002, height: 50 })).toEqual({
      x: 10,
      y: 0,
      width: 100,
      height: 50
    })
  })
  test('never negative', () => {
    expect(innerRect({ x: 5.5, y: 5.5, width: 0.2, height: 0.2 }).width).toBe(0)
  })
})
