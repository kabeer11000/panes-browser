import { describe, expect, test } from 'bun:test'
import { documentText, normalizeUrl } from './urls'

describe('normalizeUrl', () => {
  test('web pages only', () => {
    expect(normalizeUrl('https://example.com/a?b=1#frag')).toBe('https://example.com/a?b=1')
    expect(normalizeUrl('http://Example.COM/')).toBe('http://example.com')
    expect(normalizeUrl('https://example.com/x/')).toBe('https://example.com/x/')
    for (const u of [
      'panes://settings',
      'about:blank',
      'file:///c:/a.txt',
      'data:text/html,x',
      'x',
      ''
    ])
      expect(normalizeUrl(u)).toBeNull()
  })

  test('the same page has one key', () => {
    expect(normalizeUrl('https://example.com/a#one')).toBe(
      normalizeUrl('https://example.com/a#two')
    )
  })
})

describe('documentText', () => {
  test('joins, collapses white space and caps the length', () => {
    expect(documentText(' A  B ', '', 'c\n\nd')).toBe('A B\nc d')
    expect(documentText('t', 'd', 'x'.repeat(5000)).length).toBe(1500)
  })
})
