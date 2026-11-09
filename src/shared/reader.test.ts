import { describe, expect, test } from 'bun:test'
import {
  canRead,
  DEFAULT_READER_PREFS,
  readerKey,
  readerScreenDocument,
  readerSource,
  readerUrl,
  readingMinutes,
  resolvedTheme,
  sanitizeReaderPrefs,
  wordCount
} from './reader'

describe('reader addresses', () => {
  test('round trip keeps source and key', () => {
    const u = readerUrl('https://example.com/a?b=1&c=2#x', 'k 1')
    expect(readerSource(u)).toBe('https://example.com/a?b=1&c=2#x')
    expect(readerKey(u)).toBe('k 1')
  })
  test('not a reader page', () => {
    expect(readerSource('https://example.com')).toBeNull()
    expect(readerKey('panes://settings')).toBeNull()
  })
  test('a source that is not a web page is refused', () => {
    expect(readerSource(readerUrl('javascript:alert(1)', 'k'))).toBeNull()
    expect(readerSource('panes://reader/?k=a')).toBeNull()
  })
  test('only web pages can be read', () => {
    expect(canRead('https://a.b')).toBe(true)
    expect(canRead('panes://history')).toBe(false)
    expect(canRead('file:///c:/x.html')).toBe(false)
  })
})

describe('reading time', () => {
  test('counts words, not tags or entities', () => {
    expect(wordCount('<p>one <b>two</b>&amp; three</p>')).toBe(3)
    expect(wordCount('<img src="x">')).toBe(0)
  })
  test('minutes', () => {
    expect(readingMinutes('')).toBe(0)
    expect(readingMinutes('<p>short</p>')).toBe(1)
    expect(readingMinutes('<p>' + 'word '.repeat(2300) + '</p>')).toBe(10)
  })
})

describe('prefs', () => {
  test('garbage falls back to defaults', () => {
    expect(sanitizeReaderPrefs(null)).toEqual(DEFAULT_READER_PREFS)
    expect(sanitizeReaderPrefs({ font: 'comic', width: 3, theme: 'neon', size: 'x' })).toEqual(
      DEFAULT_READER_PREFS
    )
  })
  test('size is clamped and rounded', () => {
    expect(sanitizeReaderPrefs({ size: 99 }).size).toBe(28)
    expect(sanitizeReaderPrefs({ size: 2 }).size).toBe(14)
    expect(sanitizeReaderPrefs({ size: 17.6 }).size).toBe(18)
  })
  test('valid values are kept', () => {
    const p = { size: 22, font: 'sans', width: 'wide', theme: 'sepia' }
    expect(sanitizeReaderPrefs(p)).toEqual(p as never)
  })
  test('auto follows the scheme', () => {
    expect(resolvedTheme('auto', true)).toBe('dark')
    expect(resolvedTheme('auto', false)).toBe('light')
    expect(resolvedTheme('sepia', true)).toBe('sepia')
  })
})

describe('document', () => {
  const a = { title: 'T <x>', url: 'https://e.com', html: '<p>hi</p>' }
  test('no script may run and the title is escaped', () => {
    const d = readerScreenDocument(a, DEFAULT_READER_PREFS, false, '1 min')
    expect(d).toContain("default-src 'none'")
    expect(d).not.toContain('script-src')
    expect(d).toContain('T &#60;x&#62;')
    expect(d).toContain('<base target="_blank">')
  })
  test('the page h1 is not repeated', () => {
    const d = readerScreenDocument({ ...a, html: '<h1>Own</h1>' }, DEFAULT_READER_PREFS, false, '')
    expect(d).not.toContain('<h1>T')
  })
  test('prefs reach the style', () => {
    const d = readerScreenDocument(
      a,
      { size: 24, font: 'sans', width: 'wide', theme: 'sepia' },
      true,
      ''
    )
    expect(d).toContain('24px')
    expect(d).toContain('max-width:48em')
    expect(d).toContain('#f6efe2')
  })
})
