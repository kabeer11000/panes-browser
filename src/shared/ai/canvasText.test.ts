import { describe, expect, test } from 'bun:test'
import { SHAPE_KINDS } from './canvasMarks'
import { heightFor, noteFontSize, TEXT_PAD, textInset } from './canvasText'

describe('textInset', () => {
  test('every kind gives a box inside the shape, centred across it for symmetric outlines', () => {
    for (const k of SHAPE_KINDS) {
      const b = textInset(k, 200, 120)
      expect(b.x).toBeGreaterThanOrEqual(TEXT_PAD)
      expect(b.y).toBeGreaterThanOrEqual(TEXT_PAD)
      expect(b.x + b.w).toBeLessThanOrEqual(200 - TEXT_PAD + 1e-9)
      expect(b.y + b.h).toBeLessThanOrEqual(120 - TEXT_PAD + 1e-9)
    }
    for (const k of ['rect', 'rounded', 'ellipse', 'diamond'] as const) {
      const b = textInset(k, 200, 120)
      expect(b.x + b.w / 2).toBeCloseTo(100)
      expect(b.y + b.h / 2).toBeCloseTo(60)
    }
  })
  test('an ellipse keeps text inside its inscribed rectangle', () => {
    const b = textInset('ellipse', 200, 100)
    // the box's corner is inside the ellipse
    const nx = (b.x - 100) / 100
    const ny = (b.y - 50) / 50
    expect(nx * nx + ny * ny).toBeLessThanOrEqual(1)
  })
  test('a triangle writes in its lower half, a bubble above its tail', () => {
    expect(textInset('triangle', 200, 200).y).toBeGreaterThanOrEqual(100)
    const bubble = textInset('bubble', 200, 100)
    expect(bubble.y + bubble.h).toBeLessThanOrEqual(80)
  })
  test('never a negative box, even for a tiny shape', () => {
    const b = textInset('star', 12, 12)
    expect(b.w).toBeGreaterThan(0)
    expect(b.h).toBeGreaterThan(0)
  })
})

describe('heightFor', () => {
  test('grows only when the text needs more room, and then exactly enough', () => {
    expect(heightFor('rect', 100, 40)).toBe(100)
    const h = heightFor('rect', 100, 200)
    expect(h).toBe(200 + TEXT_PAD * 2)
    expect(textInset('rect', 150, h).h).toBeGreaterThanOrEqual(200 - 0.01)
    const d = heightFor('diamond', 100, 200)
    expect(textInset('diamond', 150, d).h).toBeGreaterThanOrEqual(200 - 0.01)
  })
})

describe('noteFontSize', () => {
  test('shrinks as the note says more', () => {
    const sizes = ['hi', 'a'.repeat(50), 'a'.repeat(100), 'a'.repeat(400)].map(noteFontSize)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    expect(sizes[0]).toBeGreaterThan(sizes[3])
  })
})
