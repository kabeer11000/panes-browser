import { describe, expect, test } from 'bun:test'
import {
  ACTIONS,
  buildResults,
  inlineCompletion,
  isUrlLike,
  matchActions,
  rankLocal,
  rankTabs,
  sectionOf
} from './search'
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
const tab = (id: number, url: string, title: string, usedAt = 0): TabInfo => ({
  id,
  url,
  title,
  usedAt,
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
  test('the new features are reachable by name, above web suggestions, with their shortcut', () => {
    for (const [q, id, key] of [
      ['canvas', 'canvas', 'Ctrl+Shift+K'],
      ['chat', 'chat', 'Ctrl+Shift+L'],
      ['pdf', 'print', 'Ctrl+P'],
      ['ai', 'ai-settings', undefined]
    ] as const) {
      const r = buildResults({ ...base, query: q, remote: [`${q} one`, `${q} two`] })
      const at = r.findIndex((x) => x.actionId === id)
      expect(at).toBeGreaterThan(-1)
      expect(r[at].subtitle).toBe(key)
      expect(at).toBeLessThan(r.findIndex((x) => x.kind === 'suggestion'))
    }
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

describe('rankTabs', () => {
  const H = 3_600_000
  const tabs = [
    tab(1, 'https://docs.google.com/d/1', 'Budget 2026 - Google Sheets', NOW - 1000),
    tab(2, 'https://github.com/rafay/panes', 'rafay/panes: a browser', NOW - 5 * H),
    tab(3, 'https://music.youtube.com/', 'YouTube Music', NOW - 2 * H),
    tab(4, 'https://news.example.com/github-story', 'A story about GitHub', NOW - 60_000)
  ]
  const ids = (q: string, active: number | null = 1): number[] =>
    rankTabs(tabs, q, active, NOW).tabs.map((t) => t.id)
  test('a site that starts with the word beats a mention, even one used more recently', () => {
    expect(ids('git')).toEqual([2, 4])
  })
  test('initials and camel humps find a tab', () => {
    expect(ids('ym')).toEqual([3])
    expect(ids('hub')).toContain(2)
  })
  test('every word must match; a loose in-order match still finds it', () => {
    expect(ids('github story')).toEqual([4])
    expect(ids('ytmsc')).toEqual([3])
    expect(ids('zzz')).toEqual([])
  })
  test('empty query: the tabs used last, newest first, not the one you are on', () => {
    expect(ids('')).toEqual([4, 3, 2])
  })
  test('strong when the best match is a site or word start, not when an address with a path is typed', () => {
    expect(rankTabs(tabs, 'github', 1, NOW).strong).toBe(true)
    expect(rankTabs(tabs, 'github.com', 1, NOW).strong).toBe(true)
    expect(rankTabs(tabs, 'github.com/x', 1, NOW).strong).toBe(false)
    expect(rankTabs(tabs, 'g', 1, NOW).strong).toBe(false)
    expect(rankTabs(tabs, 'ytmsc', 1, NOW).strong).toBe(false)
    expect(rankTabs(tabs, 'budget', 1, NOW).strong).toBe(false) // the tab you are on is not switched to
  })
  test('a strong tab goes above the search row, so Enter switches to it', () => {
    const r = buildResults({
      query: 'github',
      tabs,
      activeId: 1,
      local: [],
      remote: [],
      engineName: 'X',
      now: NOW
    })
    expect(r[0]).toMatchObject({ kind: 'tab', tabId: 2 })
    expect(r[1].kind).toBe('search')
    expect(r.filter((x) => x.tabId === 2)).toHaveLength(1)
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
  test('needs a prefix of the host (one character is enough) and no spaces', () => {
    expect(inlineCompletion('g', local)).toBe('github.com')
    expect(inlineCompletion('', local)).toBeNull()
    expect(inlineCompletion('hub', local)).toBeNull()
    expect(inlineCompletion('git hub', local)).toBeNull()
  })
  test('nothing to add when the host is already typed', () => {
    expect(inlineCompletion('github.com', local)).toBeNull()
  })
})

describe('command bar actions', () => {
  test('ids and shortcuts are unique', () => {
    const ids = ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    const keys = ACTIONS.flatMap((a) => (a.shortcut ? [a.shortcut] : []))
    expect(new Set(keys).size).toBe(keys.length)
  })
  test('every action has a title and is found by its own title', () => {
    for (const a of ACTIONS) {
      expect(a.title.length).toBeGreaterThan(0)
      expect(matchActions(a.title, ACTIONS.length).map((x) => x.id)).toContain(a.id)
    }
  })
  test('the app actions a person would look for are all there', () => {
    for (const [q, id] of [
      ['reader', 'reader'],
      ['mute', 'mute'],
      ['duplicate', 'duplicate'],
      ['pin', 'pin'],
      ['close other', 'close-others'],
      ['save pdf', 'save-pdf'],
      ['picture', 'pip'],
      ['split', 'split'],
      ['downloads', 'downloads'],
      ['history', 'history'],
      ['tor', 'new-tor'],
      ['incognito', 'new-private'],
      ['ai settings', 'ai-settings'],
      ['appearance', 'settings-appearance'],
      ['board', 'canvas']
    ] as const) {
      expect(matchActions(q, ACTIONS.length).map((x) => x.id)).toContain(id)
    }
  })
  test('a title that starts with the word comes before one that only mentions it', () => {
    const ids = matchActions('tab', ACTIONS.length).map((x) => x.id)
    expect(ids.indexOf('new-tab')).toBeLessThan(ids.indexOf('settings-tabs'))
    expect(ids.indexOf('settings-tabs')).toBeGreaterThan(-1)
  })
  test('nothing matches an empty query and the list is capped', () => {
    expect(matchActions('  ', 5)).toEqual([])
    expect(matchActions('tab', 2)).toHaveLength(2)
  })
})
