import { describe, expect, test } from 'bun:test'
import {
  dialogAllowed,
  dialogAnswered,
  dialogResult,
  dialogShim,
  NO_PACE,
  QUIET_MS
} from './jsDialogs'

describe('dialogShim', () => {
  const setup = (
    answer: unknown
  ): {
    g: {
      alert: (m?: unknown) => void
      confirm: (m?: unknown) => boolean
      prompt: (m?: unknown, v?: unknown) => string | null
    }
    asked: unknown[][]
  } => {
    const asked: unknown[][] = []
    const g = {} as {
      alert: (m?: unknown) => void
      confirm: (m?: unknown) => boolean
      prompt: (m?: unknown, v?: unknown) => string | null
    }
    dialogShim({ ask: (...a) => (asked.push(a), answer) }, g as unknown as typeof globalThis)
    return { g, asked }
  }
  test('alert asks and returns nothing', () => {
    const { g, asked } = setup(undefined)
    expect(g.alert(42)).toBeUndefined()
    expect(asked[0]).toEqual(['alert', '42', ''])
  })
  test('confirm is true only for a true answer', () => {
    expect(setup(true).g.confirm('Sure?')).toBe(true)
    expect(setup(false).g.confirm('Sure?')).toBe(false)
    expect(setup('yes').g.confirm('Sure?')).toBe(false)
  })
  test('prompt passes its default and returns text, or null', () => {
    const s = setup('typed')
    expect(s.g.prompt('Name?', 'Ann')).toBe('typed')
    expect(s.asked[0]).toEqual(['prompt', 'Name?', 'Ann'])
    expect(setup(null).g.prompt('Name?')).toBeNull()
  })
})

describe('dialogResult', () => {
  test('alert returns nothing; confirm OK is the second choice', () => {
    expect(dialogResult('alert', { index: 0 })).toBeUndefined()
    expect(dialogResult('confirm', { index: 1 })).toBe(true)
    expect(dialogResult('confirm', { index: 0 })).toBe(false)
    expect(dialogResult('confirm', null)).toBe(false)
  })
  test('prompt: the text on OK, null on Cancel or Escape', () => {
    expect(dialogResult('prompt', { index: 1, text: 'hi' })).toBe('hi')
    expect(dialogResult('prompt', { index: 1 })).toBe('')
    expect(dialogResult('prompt', { index: 0, text: 'hi' })).toBeNull()
    expect(dialogResult('prompt', null)).toBeNull()
  })
})

describe('dialogAllowed', () => {
  test('dialogs at the pace of a person are never stopped', () => {
    let pace = NO_PACE
    for (let i = 0; i < 10; i++) {
      const now = i * 2000
      const r = dialogAllowed(pace, now)
      expect(r.allow).toBe(true)
      pace = dialogAnswered(r.pace, now + 1500)
    }
  })
  test('a loop asking again at once is quieted, then allowed again later', () => {
    let pace = NO_PACE
    const shown: boolean[] = []
    let now = 0
    for (let i = 0; i < 6; i++) {
      const r = dialogAllowed(pace, now)
      shown.push(r.allow)
      pace = r.allow ? dialogAnswered(r.pace, now + 50) : r.pace
      now += 100 // asked again straight after each answer
    }
    expect(shown).toEqual([true, true, true, false, false, false])
    expect(dialogAllowed(pace, now + QUIET_MS).allow).toBe(true)
  })
})
