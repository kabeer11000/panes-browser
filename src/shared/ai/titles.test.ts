import { describe, expect, test } from 'bun:test'
import { cleanTitle, parseJsonObject, sanitizeModelTitle, TITLE_MAX } from './titles'

describe('cleanTitle', () => {
  test('strips a trailing site name after each separator', () => {
    expect(cleanTitle('Tokyo - Wikipedia', 'https://en.wikipedia.org/wiki/Tokyo').title).toBe(
      'Tokyo'
    )
    expect(cleanTitle('Issues | GitHub', 'https://github.com/a/b/issues').title).toBe('Issues')
    expect(cleanTitle('Cats being cats — YouTube', 'https://www.youtube.com/watch?v=1').title).toBe(
      'Cats being cats'
    )
    expect(cleanTitle('Inbox – Gmail', 'https://mail.google.com/').title).toBe('Inbox')
  })

  test('keeps a trailing segment that is not the site', () => {
    expect(cleanTitle('Pasta - Recipes', 'https://example.com/a').title).toBe('Pasta - Recipes')
  })

  test('keeps a title that is only the site name', () => {
    expect(cleanTitle('YouTube', 'https://www.youtube.com/').title).toBe('YouTube')
    expect(cleanTitle('GitHub - GitHub', 'https://github.com/').title).toBe('GitHub')
  })

  test('strips leading counters, for display only', () => {
    expect(cleanTitle('(3) Inbox', 'https://example.com').title).toBe('Inbox')
    expect(cleanTitle('(12+) Messages', 'https://example.com').title).toBe('Messages')
    expect(cleanTitle('[5] Feed', 'https://example.com').title).toBe('Feed')
  })

  test('does not strip hyphens without spaces', () => {
    expect(cleanTitle('e-mail-wikipedia', 'https://wikipedia.org').title).toBe('e-mail-wikipedia')
  })

  test('collapses white space', () => {
    expect(cleanTitle('  a \n  b\t c ', 'https://example.com').title).toBe('a b c')
  })

  test('non-English titles', () => {
    expect(cleanTitle('東京 - Wikipedia', 'https://ja.wikipedia.org/wiki/x').title).toBe('東京')
    expect(cleanTitle('Москва | Вики', 'https://ru.wikipedia.org').title).toBe('Москва | Вики')
  })

  test('short titles are untouched and need no model', () => {
    expect(cleanTitle('Docs', 'https://example.com')).toEqual({ title: 'Docs', needsModel: false })
  })

  test('needsModel only past 48 characters after cleaning', () => {
    expect(cleanTitle('x'.repeat(48), 'https://example.com').needsModel).toBe(false)
    expect(cleanTitle('x'.repeat(49), 'https://example.com').needsModel).toBe(true)
    expect(cleanTitle(`${'x'.repeat(60)} - GitHub`, 'https://github.com').needsModel).toBe(true)
    expect(cleanTitle(`${'x'.repeat(30)} - GitHub`, 'https://github.com').needsModel).toBe(false)
  })

  test('a bad url does not throw', () => {
    expect(cleanTitle('A - B', 'not a url').title).toBe('A - B')
  })
})

describe('sanitizeModelTitle', () => {
  test('first line, trimmed, unquoted', () => {
    expect(sanitizeModelTitle('  "Trip to Tokyo."\nextra')).toBe('Trip to Tokyo')
  })
  test('caps the length', () => {
    expect(sanitizeModelTitle('a'.repeat(200))?.length).toBe(TITLE_MAX)
  })
  test('control characters never survive', () => {
    expect(sanitizeModelTitle('a\u0007b')).toBe('a b')
  })
  test('nothing usable gives null', () => {
    expect(sanitizeModelTitle('')).toBeNull()
    expect(sanitizeModelTitle('  \n ')).toBeNull()
    expect(sanitizeModelTitle('""')).toBeNull()
    expect(sanitizeModelTitle(42)).toBeNull()
  })
})

describe('parseJsonObject', () => {
  test('finds the object in prose or a fence', () => {
    expect(parseJsonObject('Sure: ```json\n{"title":"A"}\n```')).toEqual({ title: 'A' })
  })
  test('rejects what is not an object', () => {
    expect(parseJsonObject('no json')).toBeNull()
    expect(parseJsonObject('{broken')).toBeNull()
    expect(parseJsonObject('{"a": }')).toBeNull()
  })
})
