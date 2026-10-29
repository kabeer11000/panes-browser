import { describe, expect, test } from 'bun:test'
import { NONE, all, between, click } from './selection'

const order = [10, 11, 12, 13, 14]
const none = { shift: false, ctrl: false }

describe('between', () => {
  test('covers the run in either direction', () => {
    expect(between(order, 11, 13)).toEqual([11, 12, 13])
    expect(between(order, 13, 11)).toEqual([11, 12, 13])
    expect(between(order, 12, 12)).toEqual([12])
  })

  test('an unknown end falls back to the clicked row alone', () => {
    expect(between(order, 99, 12)).toEqual([12])
  })
})

describe('click', () => {
  test('a plain click toggles that row and anchors there', () => {
    const one = click(NONE, order, 11, none)
    expect([...one.ids]).toEqual([11])
    expect(one.anchor).toBe(11)
    const off = click(one, order, 11, none)
    expect(off.ids.size).toBe(0)
  })

  test('Ctrl toggles rows independently', () => {
    let s = click(NONE, order, 10, { shift: false, ctrl: true })
    s = click(s, order, 13, { shift: false, ctrl: true })
    expect([...s.ids].sort()).toEqual([10, 13])
  })

  test('Shift selects the run from the anchor and can be re-stretched', () => {
    let s = click(NONE, order, 11, none)
    s = click(s, order, 13, { shift: true, ctrl: false })
    expect([...s.ids].sort()).toEqual([11, 12, 13])
    s = click(s, order, 12, { shift: true, ctrl: false })
    expect([...s.ids].sort()).toEqual([11, 12])
  })

  test('Ctrl+Shift adds the run to what is already selected', () => {
    let s = click(NONE, order, 10, none)
    s = click(s, order, 13, { shift: false, ctrl: true })
    s = click(s, order, 14, { shift: true, ctrl: true })
    expect([...s.ids].sort()).toEqual([10, 13, 14])
  })

  test('Shift with nothing to extend from just selects the row', () => {
    const s = click(NONE, order, 12, { shift: true, ctrl: false })
    expect([...s.ids]).toEqual([12])
  })
})

describe('all', () => {
  test('selects every row', () => {
    expect(all(order).ids.size).toBe(5)
    expect(all([]).anchor).toBeNull()
  })
})
