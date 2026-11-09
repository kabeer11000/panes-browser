import { describe, expect, test } from 'bun:test'
import { DEFAULT_PRINT_OPTIONS as D, normalizeOptions, type PrintOptions } from './print'
import {
  HOSTS_MAX,
  escapeHtml,
  hostKey,
  mergeOptions,
  needsCopy,
  printCss,
  readerDocument,
  rememberHost
} from './printCopy'

describe('remembering', () => {
  test('hostKey', () => {
    expect(hostKey('https://www.acme.com/a?b')).toBe('acme.com')
    expect(hostKey('panes://settings')).toBe('')
    expect(hostKey('nonsense')).toBe('')
  })
  test('site options win over the last used; bad values are dropped', () => {
    const m = mergeOptions({ landscape: true, paper: 'Letter' }, { paper: 'A3', scale: 9999 })
    expect([m.landscape, m.paper, m.scale]).toEqual([true, 'A3', 200])
  })
  test('the new switches are checked like the rest', () => {
    expect(normalizeOptions({ simplify: 'yes', noImages: true }).simplify).toBe(false)
    expect(normalizeOptions({ noImages: true }).noImages).toBe(true)
  })
  test('rememberHost keeps recent sites only and never the pages', () => {
    let h: Record<string, Partial<PrintOptions>> = {}
    for (let i = 0; i < HOSTS_MAX + 5; i++)
      h = rememberHost(h, `h${i}`, { ...D, pages: '1-2', allPages: false })
    expect(Object.keys(h).length).toBe(HOSTS_MAX)
    expect(h['h0']).toBeUndefined()
    const last = h[`h${HOSTS_MAX + 4}`]!
    expect('pages' in last || 'allPages' in last || 'copies' in last).toBe(false)
    h = rememberHost(h, 'h10', D) // used again: it moves to the end
    expect(Object.keys(h).pop()).toBe('h10')
    expect(rememberHost(h, '', D)).toBe(h)
  })
})

describe('copy and reader', () => {
  test('needsCopy and css', () => {
    expect(needsCopy(D)).toBe(false)
    expect(needsCopy({ ...D, noImages: true })).toBe(true)
    expect(needsCopy({ ...D, simplify: true })).toBe(true)
    expect(printCss(D)).toBe('')
    expect(printCss({ ...D, noImages: true })).toContain('img')
    expect(printCss({ ...D, lightBackground: true })).toContain('#fff')
  })
  test('the reader document escapes the title and forbids scripts', () => {
    const d = readerDocument(
      { title: '<b>"x"</b>', url: 'https://a.com/?q=1&r=2', html: '<p>hi</p>' },
      '9 Nov 2026'
    )
    expect(d).not.toContain('<b>')
    expect(d).toContain('q=1&#38;r=2')
    expect(d).toContain("default-src 'none'")
    expect(d).toContain('<p>hi</p>')
    expect(d).toContain('9 Nov 2026')
  })
  test('escapeHtml', () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe('&#60;a href=&#34;x&#34;&#62;&#39;&#38;')
  })
})
