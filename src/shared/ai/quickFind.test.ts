import { describe, expect, test } from 'bun:test'
import { addressKey, alreadyOpen, quickFind, type FindItem } from './quickFind'

const items: FindItem[] = [
  { id: 1, title: 'Pull requests · panes', site: 'github.com', url: 'https://github.com/pulls' },
  { id: 2, title: 'Inbox', site: 'mail.google.com', url: 'https://mail.google.com/mail/u/0/' },
  {
    id: 3,
    title: 'Weekly notes',
    site: 'notion.so',
    url: 'https://www.notion.so/notes',
    text: 'github release plan'
  },
  { id: 4, title: 'Requests for comment', site: 'ietf.org', url: 'https://ietf.org/rfc' }
]

describe('quickFind', () => {
  test('every word must match; title hits rank first, then site or address, then page text', () => {
    expect(quickFind(items, 'github')).toEqual([1, 3])
    expect(quickFind(items, 'requests')).toEqual([1, 4])
    expect(quickFind(items, 'pull github')).toEqual([1])
    expect(quickFind(items, 'nothing here')).toEqual([])
    expect(quickFind(items, '  ')).toEqual([])
  })
  test('a word at the start of a title word beats one inside a word', () => {
    expect(quickFind(items, 'req')).toEqual([1, 4])
    expect(quickFind(items, 'box')).toEqual([2])
  })
})

describe('already on the board', () => {
  test('addresses compare without scheme, www., #part or trailing slash', () => {
    expect(addressKey('https://www.Notion.so/notes/#top')).toBe('notion.so/notes')
    expect(addressKey('notion.so/notes')).toBe('notion.so/notes')
    expect(addressKey('search words')).toBeNull()
    expect(addressKey('localhost')).toBeNull()
    expect(addressKey('javascript:alert(1)')).toBeNull()
  })
  test('finds the card of an address typed in another form, none for a search', () => {
    expect(alreadyOpen(items, 'github.com/pulls/')).toBe(1)
    expect(alreadyOpen(items, 'http://notion.so/notes')).toBe(3)
    expect(alreadyOpen(items, 'github.com/issues')).toBeNull()
    expect(alreadyOpen(items, 'github pulls')).toBeNull()
  })
})
