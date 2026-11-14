import { describe, expect, test } from 'bun:test'
import { recentHeat } from './heat'

const MIN = 60_000
const now = 1_000_000_000

describe('recentHeat', () => {
  test('warmer the more recently used; nothing after a few hours or never used', () => {
    const heat = recentHeat(
      [
        { id: 1, usedAt: now - 2 * MIN },
        { id: 2, usedAt: now - 30 * MIN },
        { id: 3, usedAt: now - 3 * 60 * MIN },
        { id: 4, usedAt: now - 5 * 60 * MIN },
        { id: 5, usedAt: 0 }
      ],
      now
    )
    expect([...heat]).toEqual([
      [1, 3],
      [2, 2],
      [3, 1]
    ])
  })
  test('only the most recent few glow', () => {
    const tabs = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, usedAt: now - i * MIN }))
    const heat = recentHeat(tabs, now, 8)
    expect(heat.size).toBe(8)
    expect(heat.has(1)).toBe(true)
    expect(heat.has(9)).toBe(false)
  })
})
