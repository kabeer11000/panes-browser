import { describe, expect, test } from 'bun:test'
import { buildResults, inlineCompletion, isUrlLike, rankLocal, sectionOf } from './search'
import type { Bookmark, HistoryEntry, TabInfo } from './types'

const NOW = Date.UTC(2026, 9, 29)
const DAY = 86_400_000

const visit = (id: number, url: string, title: string, daysAgo = 0): HistoryEntry => ({
  id,
  url,
  title,
  favicon: null,
  time: NOW - daysAgo * DAY
})
const mark = (id: number, url: string, title: string): Bookmark => ({
  id,
  url,
  title,
  favicon: null,
  time: NOW - 40 * DAY
})
const tab = (id: number, url: string, title: string): TabInfo => ({
  id,
  url,
  title,
  favicon: null,
  loading: false,
  bookmarked: false,
  canGoBack: false,
  canGoForward: false
})

describe('isUrlLike', () => {
  test('addresses versus searches', () => {
    expect(isUrlLike('github.com/x')).toBe(true)
    expect(isUrlLike('localhost:3000')).toBe(true)
    expect(isUrlLike('how to cook rice')).toBe(false)
    expect(isUrlLike('cats')).toBe(false)
    expect(isUrlLike('')).toBe(false)
  })
})

describe('rankLocal', () => {
  const history = [
    visit(1, 'https://github.com/a', 'GitHub', 0),
    visit(2, 'https://github.com/a', 'GitHub', 1),
    visit(3, 'https://github.com/a', 'GitHub', 2),
    visit(4, 'https://news.example.com/github-story', 'A story about GitHub', 0),
    visit(5, 'https://old.example.org/', 'Old github mirror', 300)
  ]

  test('requires every token to match', () => {
    expect(rankLocal('github story', history, [], NOW, 10).map((s) => s.url)).toEqual([
      'https://news.example.com/github-story'
    ])
  })
  test('a host prefix beats a mention in the title or path', () => {
    expect(rankLocal('github', history, [], NOW, 10)[0].url).toBe('https://github.com/a')
  })
  test('recent beats stale for the same kind of match', () => {
    const urls = rankLocal('github', history, [], NOW, 10).map((s) => s.url)
    expect(urls.indexOf('https://news.example.com/github-story')).toBeLessThan(
      urls.indexOf('https://old.example.org/')
    )
  })
  test('bookmarks are boosted and flagged', () => {
    const r = rankLocal('', history, [mark(1, 'https://old.example.org/', 'Old')], NOW, 10)
    expect(r.find((s) => s.url === 'https://old.example.org/')?.bookmark).toBe(true)
  })
  test('empty query returns the most frecent pages first', () => {
    expect(rankLocal('', history, [], NOW, 2)[0].url).toBe('https://github.com/a')
  })
  test('respects the limit', () => {
    expect(rankLocal('', history, [], NOW, 1)).toHaveLength(1)
  })
})

describe('buildResults', () => {
  const tabs = [
    tab(1, 'https://github.com/rafay/panes', 'panes repo'),
    tab(2, 'https://youtube.com/', 'YouTube')
  ]
  const base = { tabs, activeId: 1, local: [], remote: [], engineName: 'DuckDuckGo' }

  test('typed text becomes a search at the top', () => {
    const r = buildResults({ ...base, query: 'cats' })
    expect(r[0]).toMatchObject({ kind: 'search', subtitle: 'Search DuckDuckGo' })
  })
  test('an address becomes a go-to at the top', () => {
    expect(buildResults({ ...base, query: 'github.com' })[0].kind).toBe('go')
  })
  test('open tabs matching the query are listed, others are not', () => {
    const r = buildResults({ ...base, query: 'tube' })
    expect(r.filter((x) => x.kind === 'tab').map((x) => x.tabId)).toEqual([2])
  })
  test('a page already open as a tab is not repeated from history', () => {
    const local = [
      { url: 'https://youtube.com/', title: 'YouTube', favicon: null, bookmark: false, score: 9 }
    ]
    const r = buildResults({ ...base, query: 'tube', local })
    expect(r.filter((x) => x.url === 'https://youtube.com/')).toHaveLength(1)
  })
  test('a suggestion equal to the query is dropped', () => {
    const r = buildResults({ ...base, query: 'cats', remote: ['cats', 'cats and dogs'] })
    expect(r.filter((x) => x.kind === 'suggestion').map((x) => x.title)).toEqual(['cats and dogs'])
  })
  test('actions match by keyword', () => {
    const r = buildResults({ ...base, query: 'prefer' })
    expect(r.some((x) => x.kind === 'action' && x.actionId === 'settings')).toBe(true)
  })
  test('empty query offers other tabs and actions, no search row', () => {
    const r = buildResults({ ...base, query: '' })
    expect(r.some((x) => x.kind === 'search' || x.kind === 'go')).toBe(false)
    expect(r.filter((x) => x.kind === 'tab').map((x) => x.tabId)).toEqual([2])
    expect(r.some((x) => x.kind === 'action')).toBe(true)
  })
  test('sections group results sensibly', () => {
    expect(sectionOf('search')).toBeNull()
    expect(sectionOf('history')).toBe(sectionOf('bookmark'))
  })
})

describe('inlineCompletion', () => {
  const local = [
    { url: 'https://github.com/a', title: 'GitHub', favicon: null, bookmark: false, score: 9 },
    { url: 'https://gitlab.com/', title: 'GitLab', favicon: null, bookmark: false, score: 5 }
  ]
  test('completes the site name and keeps what was typed', () => {
    expect(inlineCompletion('gith', local)).toBe('github.com')
    expect(inlineCompletion('GiTh', local)).toBe('GiTh' + 'ub.com')
  })
  test('needs a prefix of the host, at least two characters, and no spaces', () => {
    expect(inlineCompletion('g', local)).toBeNull()
    expect(inlineCompletion('hub', local)).toBeNull()
    expect(inlineCompletion('git hub', local)).toBeNull()
  })
  test('nothing to add when the host is already typed', () => {
    expect(inlineCompletion('github.com', local)).toBeNull()
  })
})
