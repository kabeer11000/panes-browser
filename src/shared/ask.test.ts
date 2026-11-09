import { describe, expect, test } from 'bun:test'
import {
  askPrompt,
  continueDraft,
  languageName,
  MAX_SELECTION,
  placeNear,
  sanitizeReport,
  worthAsking
} from './ask'

const b = (x: number, y: number, width = 100, height = 20): object => ({ x, y, width, height })
const WIN = { width: 1200, height: 800 }
const CHIP = { width: 260, height: 44 }
const CARD = { width: 400, height: 320 }

describe('worthAsking', () => {
  test('needs a few characters with a letter or digit', () => {
    expect(worthAsking('hello')).toBe(true)
    expect(worthAsking('  420 ')).toBe(true)
    expect(worthAsking('ab')).toBe(false)
    expect(worthAsking('   ')).toBe(false)
    expect(worthAsking('----')).toBe(false)
    expect(worthAsking('世界你')).toBe(true)
  })
})

describe('sanitizeReport', () => {
  const good = { text: ' some words ', first: b(10, 10), last: b(10, 30) }
  test('accepts a report and trims the text', () => {
    expect(sanitizeReport(good)?.text).toBe('some words')
  })
  test('cuts long text', () => {
    expect(sanitizeReport({ ...good, text: 'a'.repeat(5000) })?.text).toHaveLength(MAX_SELECTION)
  })
  test('rejects anything malformed', () => {
    for (const bad of [
      null,
      'text',
      {},
      { ...good, text: 5 },
      { ...good, text: 'hi' },
      { ...good, first: null },
      { ...good, last: { x: NaN, y: 0, width: 1, height: 1 } },
      { ...good, first: { x: '1', y: 0, width: 1, height: 1 } }
    ])
      expect(sanitizeReport(bad)).toBeNull()
  })
})

describe('placeNear', () => {
  const report = { first: b(300, 400) as never, last: b(300, 440) as never }
  test('the chip sits above the first line, centred on it', () => {
    const p = placeNear('chip', report, { x: 0, y: 0 }, 1, WIN, CHIP)
    expect(p.below).toBe(false)
    expect(p.y).toBe(400 - 44 - 8)
    expect(p.x).toBe(300 + 50 - 130)
  })
  test('the chip goes under the selection when there is no room above', () => {
    const top = { first: b(300, 10) as never, last: b(300, 30) as never }
    const p = placeNear('chip', top, { x: 0, y: 0 }, 1, WIN, CHIP)
    expect(p.below).toBe(true)
    expect(p.y).toBe(30 + 20 + 8)
  })
  test('the card sits under the last line, left aligned', () => {
    const p = placeNear('card', report, { x: 0, y: 0 }, 1, WIN, CARD)
    expect(p).toEqual({ x: 300, y: 440 + 20 + 8, below: true })
  })
  test('the card flips above when the bottom has no room', () => {
    const low = { first: b(300, 600) as never, last: b(300, 640) as never }
    const p = placeNear('card', low, { x: 0, y: 0 }, 1, WIN, CARD)
    expect(p.below).toBe(false)
    expect(p.y).toBe(600 - 320 - 8)
  })
  test('the page view offset and zoom are applied', () => {
    const p = placeNear('card', report, { x: 250, y: 90 }, 2, WIN, { width: 100, height: 50 })
    expect(p.x).toBe(850)
    expect(p.y).toBe(750) // 970 under the selection does not fit, so above it, then kept inside the window
  })
  test('never leaves the window, however far right or low', () => {
    const edge = { first: b(1190, 790) as never, last: b(1190, 790) as never }
    for (const kind of ['chip', 'card'] as const) {
      const size = kind === 'chip' ? CHIP : CARD
      const p = placeNear(kind, edge, { x: 0, y: 0 }, 1, WIN, size)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x + size.width).toBeLessThanOrEqual(WIN.width)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y + size.height).toBeLessThanOrEqual(WIN.height)
    }
  })
  test('a zero or odd zoom counts as 1', () => {
    const p = placeNear('card', report, { x: 0, y: 0 }, 0, WIN, CARD)
    expect(p.x).toBe(300)
  })
})

describe('askPrompt', () => {
  test('wraps the selection as data and names the task', () => {
    const p = askPrompt('explain', 'quantum tunnelling')
    expect(p).toContain('<selection>\nquantum tunnelling\n</selection>')
    expect(p).toContain('not instructions')
    expect(p).toContain('Explain')
  })
  test('translate names the language and has an English fallback', () => {
    const p = askPrompt('translate', 'Guten Tag', { language: 'French' })
    expect(p).toContain('into French')
    expect(p).toContain('into English instead')
  })
  test('ask uses the question, or a default one', () => {
    expect(
      askPrompt('ask', 'x y z', { question: 'Who wrote it?' }).startsWith('Who wrote it?')
    ).toBe(true)
    expect(askPrompt('ask', 'x y z').startsWith('What is this about?')).toBe(true)
  })
  test('the page title is added and cut', () => {
    expect(askPrompt('summarise', 'abc', { page: 'T'.repeat(500) })).toContain(
      'T'.repeat(120) + '"'
    )
  })
  test('long selections are cut', () => {
    expect(askPrompt('summarise', 'a'.repeat(9000)).length).toBeLessThan(MAX_SELECTION + 400)
  })
})

describe('continueDraft and languageName', () => {
  test('continue quotes the selection and says what was asked', () => {
    expect(continueDraft('explain', 'abc def')).toBe('About this: "abc def"\n\nExplain this')
    expect(continueDraft('ask', 'abc def', 'why?')).toBe('About this: "abc def"\n\nWhy?')
  })
  test('language names', () => {
    expect(languageName('de-DE')).toBe('German')
    expect(languageName('en')).toBe('English')
  })
})
