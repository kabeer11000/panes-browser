import { describe, expect, test } from 'bun:test'
import {
  BAYER8,
  ditherDuotone,
  duotone,
  levelsOf,
  lumaOf,
  luminanceOf,
  mix,
  parseColor
} from './dither'

const tones = { ink: [10, 10, 20] as const, paper: [200, 220, 255] as const }

/** How many of the pixels came out as paper. */
function paperShare(luma: Uint8Array, w: number, h: number, levels = { lo: 0, hi: 255 }): number {
  const out = ditherDuotone(luma, w, h, tones, levels)
  let paper = 0
  for (let i = 0; i < w * h; i++) if (out[i * 4] === tones.paper[0]) paper++
  return paper / (w * h)
}

describe('parseColor', () => {
  test('reads #rrggbb and #rgb, in any case', () => {
    expect(parseColor('#6e7bff')).toEqual([110, 123, 255])
    expect(parseColor('#FFF')).toEqual([255, 255, 255])
    expect(parseColor(' #0a0 ')).toEqual([0, 170, 0])
  })
  test('refuses anything else', () => {
    for (const bad of ['', 'red', '#12', '#12345', 'rgb(1,2,3)', null, undefined]) {
      expect(parseColor(bad)).toBeNull()
    }
  })
})

describe('mix', () => {
  test('goes from a to b', () => {
    expect(mix([0, 0, 0], [100, 200, 50], 0)).toEqual([0, 0, 0])
    expect(mix([0, 0, 0], [100, 200, 50], 1)).toEqual([100, 200, 50])
    expect(mix([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25])
  })
})

describe('duotone', () => {
  test('ink is always clearly darker than paper, whatever the colours', () => {
    for (const [c, c2] of [
      ['#6e7bff', null],
      ['#2bb3a3', '#d65b9a'],
      ['#000000', null],
      ['#ffffff', null],
      ['#101010', '#050505'],
      ['nonsense', null]
    ] as const) {
      const { ink, paper } = duotone(c, c2)
      expect(luminanceOf(paper) - luminanceOf(ink)).toBeGreaterThan(60)
    }
  })
  test('with a second colour the paper takes its hue, not the first colour', () => {
    const { paper } = duotone('#ff0000', '#0000ff')
    expect(paper[2]).toBeGreaterThan(paper[0])
  })
  test('ink keeps a hint of the colour', () => {
    const { ink } = duotone('#ff0000', null)
    expect(ink[0]).toBeGreaterThan(ink[1])
  })
})

describe('BAYER8', () => {
  test('has each of 0 to 63 once', () => {
    expect([...BAYER8].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i))
  })
})

describe('ditherDuotone', () => {
  const w = 16
  const h = 16
  const flat = (v: number): Uint8Array => new Uint8Array(w * h).fill(v)

  test('black is all ink and white is all paper', () => {
    expect(paperShare(flat(0), w, h)).toBe(0)
    expect(paperShare(flat(255), w, h)).toBe(1)
  })
  test('a mid grey is about half and half', () => {
    expect(paperShare(flat(128), w, h)).toBeGreaterThan(0.4)
    expect(paperShare(flat(128), w, h)).toBeLessThan(0.6)
  })
  test('brighter gives more paper, step by step', () => {
    const shares = [30, 80, 128, 180, 230].map((v) => paperShare(flat(v), w, h))
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeGreaterThan(shares[i - 1])
  })
  test('uses only the two tones, fully opaque', () => {
    const out = ditherDuotone(flat(100), w, h, tones, { lo: 0, hi: 255 })
    for (let i = 0; i < w * h; i++) {
      const px = [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]]
      expect([tones.ink, tones.paper].some((t) => t.every((c, k) => c === px[k]))).toBe(true)
      expect(out[i * 4 + 3]).toBe(255)
    }
  })
  test('the same picture gives the same dither', () => {
    const a = ditherDuotone(flat(97), w, h, tones, { lo: 0, hi: 255 })
    const b = ditherDuotone(flat(97), w, h, tones, { lo: 0, hi: 255 })
    expect(a).toEqual(b)
  })
  test('a size that is not a multiple of 8 still works', () => {
    const out = ditherDuotone(new Uint8Array(13 * 5).fill(128), 13, 5, tones, { lo: 0, hi: 255 })
    expect(out).toHaveLength(13 * 5 * 4)
  })
})

describe('lumaOf and levelsOf', () => {
  test('lumaOf reads brightness from RGBA', () => {
    const luma = lumaOf([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255])
    expect(luma[0]).toBe(0)
    expect(luma[1]).toBe(255)
    expect(luma[2]).toBeGreaterThan(0)
    expect(luma[2]).toBeLessThan(100) // pure red is dark
  })
  test('levels ignore a few extreme pixels', () => {
    const luma = new Uint8Array(1000).fill(120)
    luma[0] = 0
    luma[1] = 255
    const { lo, hi } = levelsOf(luma)
    expect(lo).toBe(120)
    expect(hi).toBe(121) // a flat picture gets a range of 1, never 0
  })
  test('a spread picture keeps its spread', () => {
    const luma = Uint8Array.from({ length: 1000 }, (_, i) => Math.round((i / 999) * 255))
    const { lo, hi } = levelsOf(luma)
    expect(lo).toBeLessThan(15)
    expect(hi).toBeGreaterThan(240)
  })
  test('stretching lifts a dull picture: a narrow range still reaches both tones', () => {
    const luma = Uint8Array.from({ length: 256 }, (_, i) => 100 + Math.round((i / 255) * 40))
    const levels = levelsOf(luma)
    const share = paperShare(luma, 16, 16, levels)
    expect(share).toBeGreaterThan(0.3)
    expect(share).toBeLessThan(0.7)
  })
})
