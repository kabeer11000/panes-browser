import { describe, expect, test } from 'bun:test'
import { S_MAX, S_MIN, harmonize, hexToHsl, hslToHex, tasteful, wheelDistance } from './color'

describe('colour conversion', () => {
  test('primary colours', () => {
    expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 1, l: 0.5 })
    expect(hexToHsl('#00ff00').h).toBeCloseTo(120)
    expect(hexToHsl('#0000ff').h).toBeCloseTo(240)
  })
  test('greys have no saturation', () => {
    expect(hexToHsl('#808080').s).toBe(0)
  })
  test('hex -> hsl -> hex round-trips', () => {
    for (const hex of ['#6e7bff', '#2bb3a3', '#e5754c', '#d65b9a', '#123456', '#fedcba']) {
      expect(hslToHex(hexToHsl(hex))).toBe(hex)
    }
  })
  test('hue wraps cleanly at the ends of the wheel', () => {
    expect(hslToHex({ h: 0, s: 1, l: 0.5 })).toBe('#ff0000')
    expect(hslToHex({ h: 359.9, s: 1, l: 0.5 })).toBe('#ff0000')
  })
})

describe('tasteful colours', () => {
  test('never produces greys or neon, whatever the wheel position', () => {
    for (let h = 0; h < 360; h += 15) {
      for (const t of [0, 0.5, 1]) {
        const { s, l } = hexToHsl(tasteful(h, t))
        expect(s).toBeGreaterThan(S_MIN - 0.03)
        expect(s).toBeLessThan(S_MAX + 0.03)
        expect(l).toBeGreaterThan(0.48)
        expect(l).toBeLessThan(0.66)
      }
    }
  })
  test('wheel distance inverts the saturation mapping', () => {
    expect(wheelDistance(tasteful(120, 0))).toBeCloseTo(0, 1)
    expect(wheelDistance(tasteful(120, 1))).toBeCloseTo(1, 1)
    expect(wheelDistance(tasteful(120, 0.5))).toBeCloseTo(0.5, 1)
  })
})

describe('harmonize', () => {
  const base = tasteful(200, 0.6)
  const hueOf = (hex: string): number => hexToHsl(hex).h
  const apart = (a: number, b: number): number => ((b - a + 540) % 360) - 180
  test('complementary sits opposite on the wheel', () => {
    expect(Math.abs(apart(hueOf(base), hueOf(harmonize(base, 'complementary'))))).toBeGreaterThan(
      170
    )
  })
  test('triad is a third of the wheel away', () => {
    expect(Math.abs(apart(hueOf(base), hueOf(harmonize(base, 'triad'))))).toBeGreaterThan(112)
    expect(Math.abs(apart(hueOf(base), hueOf(harmonize(base, 'triad'))))).toBeLessThan(128)
  })
  test('analogous stays close', () => {
    expect(Math.abs(apart(hueOf(base), hueOf(harmonize(base, 'analogous'))))).toBeLessThan(45)
  })
})
