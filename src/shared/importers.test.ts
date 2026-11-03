import { describe, expect, test } from 'bun:test'
import {
  BROWSER_SOURCES,
  chromeTimeMs,
  chromiumBookmarks,
  chromiumProfiles,
  chromiumSearchUrl,
  firefoxProfiles,
  htmlBookmarks,
  mergeByTime,
  searchEngineFor,
  sourceRoot
} from './importers'

const brave = BROWSER_SOURCES.find((s) => s.id === 'brave')!

describe('sourceRoot', () => {
  test('fills in the environment and the home folder', () => {
    expect(sourceRoot(brave, 'win32', { LOCALAPPDATA: 'C:/U/AppData/Local' }, 'C:/U')).toBe(
      'C:/U/AppData/Local/BraveSoftware/Brave-Browser/User Data'
    )
    expect(sourceRoot(brave, 'linux', {}, '/home/a')).toBe(
      '/home/a/.config/BraveSoftware/Brave-Browser'
    )
  })
  test('null without the variable or the platform', () => {
    expect(sourceRoot(brave, 'win32', {}, 'C:/U')).toBeNull()
    expect(sourceRoot(brave, 'aix', {}, '/h')).toBeNull()
  })
})

describe('profiles', () => {
  test('Chromium: Local State names, Default first; Default when unreadable', () => {
    const ls = JSON.stringify({
      profile: { info_cache: { 'Profile 3': { name: 'Work' }, Default: { name: 'Me' } } }
    })
    expect(chromiumProfiles(ls)).toEqual([
      { dir: 'Default', name: 'Me' },
      { dir: 'Profile 3', name: 'Work' }
    ])
    expect(chromiumProfiles('{broken')).toEqual([{ dir: 'Default', name: 'Default' }])
    expect(chromiumProfiles(null)).toEqual([{ dir: 'Default', name: 'Default' }])
  })
  test('Firefox: profiles.ini, the default first, other sections ignored', () => {
    const ini = [
      '[General]',
      'StartWithLastProfile=1',
      '[Profile1]',
      'Name=old',
      'IsRelative=1',
      'Path=Profiles/a.old',
      '',
      '[Profile0]',
      'Name=default-release',
      'IsRelative=1',
      'Path=Profiles/b.default-release',
      'Default=1',
      '[Install308046B0AF4A39CB]',
      'Default=Profiles/b.default-release'
    ].join('\r\n')
    expect(firefoxProfiles(ini)).toEqual([
      { dir: 'Profiles/b.default-release', name: 'default-release' },
      { dir: 'Profiles/a.old', name: 'old' }
    ])
  })
})

describe('chromeTimeMs', () => {
  test('microseconds since 1601 to milliseconds since 1970', () => {
    // 2024-01-01T00:00:00Z
    expect(chromeTimeMs('13348540800000000')).toBe(Date.UTC(2024, 0, 1))
    expect(chromeTimeMs('0')).toBe(0)
    expect(chromeTimeMs(undefined)).toBe(0)
  })
})

describe('chromiumBookmarks', () => {
  test('every web bookmark in every root, folders flattened', () => {
    const json = JSON.stringify({
      checksum: 'x',
      roots: {
        bookmark_bar: {
          type: 'folder',
          children: [
            { type: 'url', name: 'A', url: 'https://a.com/', date_added: '13348540800000000' },
            {
              type: 'folder',
              name: 'Work',
              children: [{ type: 'url', name: '', url: 'https://b.com/' }]
            },
            { type: 'url', name: 'js', url: 'javascript:alert(1)' }
          ]
        },
        other: { type: 'folder', children: [{ type: 'url', name: 'C', url: 'http://c.com/' }] }
      }
    })
    expect(chromiumBookmarks(json)).toEqual([
      { url: 'https://a.com/', title: 'A', time: Date.UTC(2024, 0, 1) },
      { url: 'https://b.com/', title: 'https://b.com/', time: 0 },
      { url: 'http://c.com/', title: 'C', time: 0 }
    ])
  })
})

describe('htmlBookmarks', () => {
  test('the Netscape export: links, entities, times, folders flattened', () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 ADD_DATE="1">Bar</H3>
  <DL><p>
    <DT><A HREF="https://a.com/?x=1&amp;y=2" ADD_DATE="1704067200" ICON="data:x">A &amp; B</A>
    <DT><a href="place:sort=8">Recent</a>
  </DL><p>
  <DT><A HREF="https://c.com/">  </A>
</DL>`
    expect(htmlBookmarks(html)).toEqual([
      { url: 'https://a.com/?x=1&y=2', title: 'A & B', time: Date.UTC(2024, 0, 1) },
      { url: 'https://c.com/', title: 'https://c.com/', time: 0 }
    ])
  })
})

describe('search engine', () => {
  test('known engines by host, others null', () => {
    expect(searchEngineFor('https://search.brave.com/search?q={searchTerms}')).toBe('brave')
    expect(searchEngineFor('{google:baseURL}search?q={searchTerms}')).toBeNull()
    expect(searchEngineFor('https://www.google.co.uk/search?q={searchTerms}')).toBe('google')
    expect(searchEngineFor('https://www.bing.com/search?q={searchTerms}&form=X')).toBe('bing')
    expect(searchEngineFor('https://duckduckgo.com/?q={searchTerms}')).toBe('duckduckgo')
    expect(searchEngineFor('https://www.ecosia.org/search?q={searchTerms}')).toBeNull()
    expect(searchEngineFor(undefined)).toBeNull()
  })
  test('read from Preferences', () => {
    const prefs = JSON.stringify({
      default_search_provider_data: { template_url_data: { url: 'https://search.brave.com/s' } }
    })
    expect(chromiumSearchUrl(prefs)).toBe('https://search.brave.com/s')
    expect(chromiumSearchUrl('{}')).toBeUndefined()
    expect(chromiumSearchUrl('nope')).toBeUndefined()
  })
})

describe('mergeByTime', () => {
  const make = (
    p: { url: string; time: number },
    id: number
  ): { id: number; url: string; time: number } => ({
    id,
    url: p.url,
    time: p.time
  })
  test('newest first, no repeats, capped, ids from nextId', () => {
    const existing = [
      { id: 1, url: 'https://a.com/', time: 300 },
      { id: 2, url: 'https://b.com/', time: 100 }
    ]
    const incoming = [
      { url: 'https://a.com/', title: '', time: 300 }, // already there
      { url: 'https://c.com/', title: '', time: 200 },
      { url: 'https://c.com/', title: '', time: 200 }, // twice in the import
      { url: 'https://d.com/', title: '', time: 50 }, // falls off the cap
      { url: 'chrome://settings', title: '', time: 400 } // not a web page
    ]
    const r = mergeByTime(existing, incoming, make, 3, 3)
    expect(r.items.map((i) => [i.id, i.url])).toEqual([
      [1, 'https://a.com/'],
      [3, 'https://c.com/'],
      [2, 'https://b.com/']
    ])
    expect(r.added).toBe(1)
    expect(r.nextId).toBe(5)
  })
  test('running it twice adds nothing the second time', () => {
    const incoming = [{ url: 'https://a.com/', title: '', time: 0 }]
    const once = mergeByTime([], incoming, make, 1, 10, 1000)
    const twice = mergeByTime(once.items, incoming, make, once.nextId, 10, 1000)
    expect(twice.added).toBe(0)
    expect(twice.items).toHaveLength(1)
  })
})
