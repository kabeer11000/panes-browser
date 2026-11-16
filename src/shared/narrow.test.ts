import { describe, expect, test } from 'bun:test'
import { NARROW_W, narrowStep } from './narrow'

const wide = { narrow: false, tucked: false }

describe('narrowStep', () => {
  test('an open sidebar tucks away when the window gets narrow, and comes back when it is wide', () => {
    const a = narrowStep(wide, NARROW_W - 1, true)
    expect(a.sidebar).toBe('close')
    const b = narrowStep(a.next, NARROW_W + 100, false)
    expect(b.sidebar).toBe('open')
    expect(b.next).toEqual(wide)
  })
  test('a closed sidebar stays closed either way', () => {
    const a = narrowStep(wide, 700, false)
    expect(a.sidebar).toBeNull()
    expect(narrowStep(a.next, 1200, false).sidebar).toBeNull()
  })
  test('opened by the person while narrow: it is not reopened or closed again when wide', () => {
    const a = narrowStep(wide, 700, true)
    expect(narrowStep(a.next, 1200, true).sidebar).toBeNull()
  })
  test('resizes within the same side do nothing', () => {
    const a = narrowStep(wide, 700, true)
    expect(narrowStep(a.next, 750, false)).toEqual({ next: a.next, sidebar: null })
    expect(narrowStep(wide, 1300, true)).toEqual({ next: wide, sidebar: null })
  })
})
