import { describe, expect, test } from 'bun:test'
import { PROMPT_CARD_WIDTH, parseAnchor, promptBox } from './anchor'

describe('promptBox', () => {
  const address = { x: 420, y: 7, width: 560, height: 26 }
  const canvasHead = { x: 48, y: 8, width: 300, height: 34 }

  test('hangs under the address field when the top bar is there', () => {
    expect(promptBox([address, canvasHead], 1400)).toEqual(address)
  })

  test('on the canvas (no address field) hangs under the open page header', () => {
    expect(promptBox([null, canvasHead], 1400)).toEqual(canvasHead)
  })

  test('skips candidates that are not laid out (zero size)', () => {
    expect(promptBox([{ ...address, width: 0 }, canvasHead], 1400)).toEqual(canvasHead)
    expect(promptBox([{ ...address, height: 0 }, undefined, canvasHead], 1400)).toEqual(canvasHead)
  })

  test('with nothing to hang from (the bare canvas) still shows, top centre', () => {
    const box = promptBox([null, undefined], 1400)
    expect(box.x).toBe((1400 - PROMPT_CARD_WIDTH) / 2)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.width).toBe(PROMPT_CARD_WIDTH)
  })

  test('a window narrower than the card puts it at the left edge, not off screen', () => {
    expect(promptBox([], 200).x).toBe(0)
  })
})

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
