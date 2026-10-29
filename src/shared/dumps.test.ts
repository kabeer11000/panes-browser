import { describe, expect, test } from 'bun:test'
import { dumpMailto, dumpText, dumpableTabs, sanitizeName, type TabDump } from './dumps'

const tab = (url: string, title = ''): { url: string; title: string; favicon: null } => ({
  url,
  title,
  favicon: null
})

describe('dumpableTabs', () => {
  test('keeps web and file pages, drops internal ones and repeats, in order', () => {
    const out = dumpableTabs([
      tab('https://a.com', 'A'),
      tab('panes://settings'),
      tab(''),
      tab('https://a.com', 'again'),
      tab('file:///x.pdf')
    ])
    expect(out.map((t) => t.url)).toEqual(['https://a.com', 'file:///x.pdf'])
  })
  test('an untitled page is titled by its address', () => {
    expect(dumpableTabs([tab('https://a.com')])[0].title).toBe('https://a.com')
  })
})

describe('dumpText and dumpMailto', () => {
  const dump: TabDump = {
    id: 1,
    name: 'Trip',
    time: 0,
    tabs: [tab('https://a.com', 'A'), tab('https://b.com', 'https://b.com')]
  }
  test('text lists title and address, address alone when they match', () => {
    expect(dumpText(dump)).toBe('Trip\n\nA\nhttps://a.com\nhttps://b.com')
  })
  test('mailto carries subject and body, encoded', () => {
    const link = dumpMailto(dump) as string
    expect(link.startsWith('mailto:?subject=Trip&body=')).toBe(true)
    expect(link).toContain(encodeURIComponent('https://a.com'))
  })
  test('too long for a mail link gives null', () => {
    const big: TabDump = {
      ...dump,
      tabs: Array.from({ length: 80 }, (_, i) => tab(`https://site${i}.com/path`))
    }
    expect(dumpMailto(big)).toBeNull()
  })
})

describe('sanitizeName', () => {
  test('trims, caps, and falls back', () => {
    expect(sanitizeName('  hi  ', 'x')).toBe('hi')
    expect(sanitizeName('a'.repeat(200), 'x')).toHaveLength(80)
    expect(sanitizeName('   ', 'x')).toBe('x')
    expect(sanitizeName(5, 'x')).toBe('x')
  })
})
