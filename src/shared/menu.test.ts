import { describe, expect, test } from 'bun:test'
import {
  inTriangle,
  placeMenu,
  placeSubmenu,
  safeTriangle,
  tidyMenu,
  typeAhead,
  type MenuEntry
} from './menu'

const b = { w: 1000, h: 700 }
const size = { w: 220, h: 300 }

describe('placeMenu', () => {
  test('opens right and down from the pointer when there is room', () => {
    expect(placeMenu({ x: 100, y: 100 }, size, b)).toEqual({
      x: 100,
      y: 100,
      left: false,
      up: false,
      maxH: undefined
    })
  })
  test('flips left at the right edge and up at the bottom', () => {
    const p = placeMenu({ x: 900, y: 600 }, size, b)
    expect(p).toMatchObject({ x: 680, y: 300, left: true, up: true })
  })
  test('clamps inside the bounds and scrolls when taller than the room', () => {
    const p = placeMenu({ x: 5, y: 5 }, { w: 220, h: 900 }, b)
    expect(p.x).toBe(8)
    expect(p.y).toBe(8)
    expect(p.maxH).toBe(684)
  })
  test('narrow window: clamped, never off the left', () => {
    const p = placeMenu({ x: 150, y: 50 }, size, { w: 200, h: 700 })
    expect(p.x).toBe(8)
  })
  test('moves off a rect to avoid (the AI dock on the right)', () => {
    const dock = { x: 600, y: 0, w: 400, h: 700 }
    const p = placeMenu({ x: 500, y: 100 }, size, b, [dock])
    expect(p.x + size.w).toBeLessThanOrEqual(600)
    expect(p.left).toBe(true)
  })
  test('a live page in the middle: goes beside it', () => {
    const live = { x: 300, y: 0, w: 500, h: 700 }
    const p = placeMenu({ x: 400, y: 200 }, size, b, [live])
    expect(p.x + size.w).toBeLessThanOrEqual(300)
  })
  test('no room beside it either: the place covering least of it', () => {
    const live = { x: 100, y: 0, w: 850, h: 700 }
    const p = placeMenu({ x: 400, y: 200 }, size, b, [live])
    expect(p.x).toBe(8)
  })
})

describe('placeSubmenu', () => {
  const parent = { x: 100, y: 100, w: 220, h: 300 }
  const row = { x: 105, y: 160, w: 210, h: 30 }
  test('right of the parent, first item level with the row', () => {
    expect(placeSubmenu(row, parent, { w: 180, h: 200 }, b)).toMatchObject({
      x: 318,
      y: 155,
      left: false
    })
  })
  test('flips left when there is no room on the right', () => {
    const p2 = { ...parent, x: 700 }
    const p = placeSubmenu({ ...row, x: 705 }, p2, { w: 180, h: 200 }, b)
    expect(p.left).toBe(true)
    expect(p.x).toBe(700 - 180 + 2)
  })
  test('kept inside the bottom', () => {
    const p = placeSubmenu({ ...row, y: 650 }, parent, { w: 180, h: 200 }, b)
    expect(p.y).toBe(700 - 200 - 8)
  })
})

describe('typeAhead', () => {
  const labels = ['Open', 'Open live', 'Pop out', 'Copy link', 'Close tab']
  test('jumps to the next item starting with the letter, wrapping', () => {
    expect(typeAhead(labels, -1, 'c')).toBe(3)
    expect(typeAhead(labels, 3, 'c')).toBe(4)
    expect(typeAhead(labels, 4, 'c')).toBe(3)
  })
  test('a repeated letter cycles', () => {
    expect(typeAhead(labels, 0, 'oo')).toBe(1)
  })
  test('a longer query stays while it matches', () => {
    expect(typeAhead(labels, 3, 'co')).toBe(3)
    expect(typeAhead(labels, 3, 'cl')).toBe(4)
  })
  test('skips disabled items, case and accents aside', () => {
    expect(typeAhead(labels, -1, 'O', [true, false])).toBe(1)
    expect(typeAhead(['Élan'], -1, 'e')).toBe(0)
    expect(typeAhead(labels, 0, 'z')).toBe(-1)
  })
})

describe('safe triangle', () => {
  test('a point on the way to the submenu is inside; one going up and away is not', () => {
    const [a, b2, c] = safeTriangle({ x: 300, y: 175 }, { x: 318, y: 100, w: 180, h: 200 })
    expect(inTriangle({ x: 310, y: 170 }, a, b2, c)).toBe(true)
    expect(inTriangle({ x: 290, y: 120 }, a, b2, c)).toBe(false)
  })
  test('works for a submenu on the left too', () => {
    const [a, b2, c] = safeTriangle({ x: 300, y: 175 }, { x: 100, y: 100, w: 180, h: 200 })
    expect(b2.x).toBe(280)
    expect(inTriangle({ x: 290, y: 176 }, a, b2, c)).toBe(true)
  })
})

describe('tidyMenu', () => {
  test('drops leading, trailing and doubled separators, and empty submenus', () => {
    const items: MenuEntry[] = [
      'sep',
      { id: 'a', label: 'A' },
      'sep',
      'sep',
      { id: 'm', label: 'M', items: ['sep'] },
      { id: 'b', label: 'B' },
      'sep'
    ]
    expect(tidyMenu(items)).toEqual([{ id: 'a', label: 'A' }, 'sep', { id: 'b', label: 'B' }])
  })
})
