import { describe, expect, test } from 'bun:test'
import { cardSpot, matchCombo, TOUR_STEPS, type KeyLike } from './tour'

const press = (over: Partial<KeyLike>): KeyLike => ({
  key: 't',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over
})

const card = { w: 300, h: 160 }
const win = { w: 1200, h: 800 }

describe('tour', () => {
  test('steps have unique ids, and begin and end with a centred step', () => {
    const ids = TOUR_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(TOUR_STEPS[0].target).toBeUndefined()
    expect(TOUR_STEPS.at(-1)!.target).toBeUndefined()
  })
  test('the card goes below its target, above when there is no room, beside a tall one, centred with none', () => {
    expect(cardSpot({ x: 500, y: 10, w: 200, h: 30 }, card, win)).toEqual({ x: 450, y: 52 })
    expect(cardSpot({ x: 500, y: 700, w: 200, h: 40 }, card, win)).toEqual({ x: 450, y: 528 })
    expect(cardSpot({ x: 0, y: 60, w: 240, h: 730 }, card, win)).toEqual({ x: 252, y: 60 })
    expect(cardSpot(null, card, win)).toEqual({ x: 450, y: 320 })
  })
  test('the card stays inside the window', () => {
    const at = cardSpot({ x: 1150, y: 10, w: 40, h: 30 }, card, win)
    expect(at.x + card.w).toBeLessThanOrEqual(win.w - 12)
  })
})

describe('matchCombo', () => {
  test('a plain Ctrl shortcut needs Ctrl and the key, and no extra modifier', () => {
    expect(matchCombo('Ctrl+L', press({ key: 'l', ctrlKey: true }))).toBe(true)
    expect(matchCombo('Ctrl+L', press({ key: 'l' }))).toBe(false) // no Ctrl
    expect(matchCombo('Ctrl+L', press({ key: 'l', ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(matchCombo('Ctrl+L', press({ key: 'k', ctrlKey: true }))).toBe(false)
  })
  test('Shift and the backslash and Tab keys', () => {
    expect(matchCombo('Ctrl+Shift+K', press({ key: 'K', ctrlKey: true, shiftKey: true }))).toBe(
      true
    )
    expect(matchCombo('Ctrl+Shift+K', press({ key: 'k', ctrlKey: true }))).toBe(false) // needs Shift
    expect(matchCombo('Ctrl+\\', press({ key: '\\', ctrlKey: true }))).toBe(true)
    expect(matchCombo('Ctrl+Tab', press({ key: 'Tab', ctrlKey: true }))).toBe(true)
  })
  test('on a Mac the command key stands in for Ctrl', () => {
    expect(matchCombo('Ctrl+L', press({ key: 'l', metaKey: true }), true)).toBe(true)
    expect(matchCombo('Ctrl+L', press({ key: 'l', ctrlKey: true }), true)).toBe(false)
  })
  test('every step that shows keys also has a cue to try them', () => {
    for (const s of TOUR_STEPS) if (s.keys) expect(s.cue).toBeTruthy()
  })
})
