import { describe, expect, test } from 'bun:test'
import { parseAnchor } from './anchor'

const good = {
  x: 120,
  y: 8,
  width: 400,
  height: 32,
  theme: { scheme: 'dark', color: '#6e7bff', color2: '#fb7185' }
}

describe('parseAnchor', () => {
  test('accepts a well-formed anchor', () => {
    expect(parseAnchor(good)).toEqual(good)
  })

  test('rejects things that are not objects', () => {
    for (const v of [null, undefined, 5, 'x', true]) expect(parseAnchor(v)).toBeNull()
  })

  test('rejects missing or non-finite numbers', () => {
    expect(parseAnchor({ ...good, x: undefined })).toBeNull()
    expect(parseAnchor({ ...good, y: Number.NaN })).toBeNull()
    expect(parseAnchor({ ...good, width: Infinity })).toBeNull()
    expect(parseAnchor({ ...good, height: '32' })).toBeNull()
  })

  test('rejects a missing theme or unknown scheme', () => {
    expect(parseAnchor({ ...good, theme: undefined })).toBeNull()
    expect(parseAnchor({ ...good, theme: { ...good.theme, scheme: 'sepia' } })).toBeNull()
  })

  test('rejects colours that are not hex, so they can never smuggle CSS', () => {
    for (const color of ['red', 'url(x)', '#12', '#zzzzzz', '#fff; background: red', '']) {
      expect(parseAnchor({ ...good, theme: { ...good.theme, color } })).toBeNull()
      expect(parseAnchor({ ...good, theme: { ...good.theme, color2: color } })).toBeNull()
    }
  })
})
