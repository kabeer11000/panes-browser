import { describe, expect, test } from 'bun:test'
import { filterScript, wants } from './pageFilter'

describe('wants', () => {
  test('keeps items with a keep word, drops any with a hide word, case-insensitive', () => {
    expect(wants('Fix login - Rafay Khan', ['rafay'], [])).toBe(true)
    expect(wants('Fix login - Sara', ['rafay'], [])).toBe(false)
    expect(wants('Cat video #Shorts', [], ['shorts'])).toBe(false)
    expect(wants('Cat video', [], ['shorts'])).toBe(true)
    expect(wants('Rafay #shorts', ['rafay'], ['shorts'])).toBe(false)
    expect(wants('anything', [], [])).toBe(true)
  })
})

describe('filterScript', () => {
  test('is one self-contained expression with the arguments in it', () => {
    const s = filterScript({ keep: ['a"b'], hide: [], reset: false })
    expect(s.startsWith('(function') || s.startsWith('(filterInPage') || s.startsWith('(')).toBe(
      true
    )
    expect(s).toContain(JSON.stringify(['a"b']))
    // parses as JavaScript (it is never run here: it needs a page)
    expect(() => new Function(`return () => ${s}`)).not.toThrow()
  })
})
