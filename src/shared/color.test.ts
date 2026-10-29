import { describe, expect, test } from 'bun:test'
import {
  S_MAX,
  S_MIN,
  harmonize,
  hexToHsl,
  hslToHex,
  mixHex,
  stageBackground,
  tasteful,
  wheelDistance
} from './color'

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

describe('stage background', () => {
  test('mixHex blends by share and clamps', () => {
    expect(mixHex('#ff0000', '#000000', 0.5)).toBe('#800000')
    expect(mixHex('#ff0000', '#0000ff', 1)).toBe('#ff0000')
    expect(mixHex('#ff0000', '#0000ff', 0)).toBe('#0000ff')
    expect(mixHex('#ff0000', '#0000ff', 7)).toBe('#ff0000')
  })

  test('no tint leaves the plain page colour, more tint leans toward the space colour', () => {
    expect(stageBackground('#e5754c', 0, true)).toBe('#121216')
    expect(stageBackground('#e5754c', 0, false)).toBe('#ffffff')
    const soft = stageBackground('#e5754c', 0.24, true)
    const strong = stageBackground('#e5754c', 0.7, true)
    expect(parseInt(strong.slice(1, 3), 16)).toBeGreaterThan(parseInt(soft.slice(1, 3), 16))
    expect(parseInt(soft.slice(1, 3), 16)).toBeGreaterThan(0x12)
  })
})

import { contrastRatio, legibility, luminance, maxSafeTint } from './color'

describe('contrast guard', () => {
  test('luminance and ratio extremes', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
  })
  test('maxSafeTint keeps text at 4.5 or better', () => {
    for (const c of ['#f2d94e', '#2bb3a3', '#1d2a6b', '#ffffff']) {
      for (const dark of [true, false]) {
        const t = maxSafeTint(c, null, dark)
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThanOrEqual(0.7)
        expect(legibility(c, null, t, dark)).toBeGreaterThanOrEqual(4.49)
      }
    }
  })
  test('bright colours are limited more than dark ones in dark mode', () => {
    expect(maxSafeTint('#f2d94e', null, true)).toBeLessThan(maxSafeTint('#1d2a6b', null, true))
  })
})

import { accentFor, chromeVars, hexToHsl } from './color'

describe('accentFor', () => {
  const DEF = '#8b8bff'
  test('a colour chosen in settings always wins', () => {
    expect(accentFor('#ff0000', DEF, '#2bb3a3', true)).toBe('#ff0000')
  })
  test('a space lends its own muted hue, whatever its tint', () => {
    const a = hexToHsl(accentFor(DEF, DEF, '#2bb36a', true))
    const space = hexToHsl('#2bb36a')
    expect(Math.abs(a.h - space.h)).toBeLessThan(8)
    expect(a.s).toBeLessThan(space.s)
    expect(accentFor(DEF, DEF, '#2bb36a', true)).not.toBe(DEF)
  })
  test('made visible against the window', () => {
    const dark = accentFor(DEF, DEF, '#1d2a6b', true)
    expect(contrastRatio(dark, '#15151b')).toBeGreaterThanOrEqual(3)
    const light = accentFor(DEF, DEF, '#f2d94e', false)
    expect(contrastRatio(light, '#eeeef4')).toBeGreaterThanOrEqual(3)
  })
  test('a grey space gets a grey accent, still visible', () => {
    const grey = accentFor(DEF, DEF, '#8b8b8b', true)
    expect(hexToHsl(grey).s).toBeLessThan(0.05)
    expect(contrastRatio(grey, '#15151b')).toBeGreaterThanOrEqual(3)
  })
})

describe('chromeVars', () => {
  test('tint is held to the readable limit', () => {
    const v = chromeVars({ color: '#f2d94e', color2: null, tint: 0.7 }, true, '#8b8bff', '#8b8bff')
    expect(Number.parseInt(v['--tint'])).toBeLessThan(40)
    expect(v['--space2']).toBe('#f2d94e')
  })
})
