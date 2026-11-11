import { describe, expect, test } from 'bun:test'
import {
  chromiumSessionTabs,
  FIREFOX_SESSION_FILES,
  firefoxSessionTabs,
  lz4Block,
  mozLz4,
  newestChromiumSession,
  readFirefoxSession,
  shiftSelected
} from './sessionImport'

/** A tiny SNSS writer: records of uint16 size, uint8 command id and a payload. */
class Snss {
  private parts: number[] = []
  constructor(version = 3) {
    this.parts.push(...[0x53, 0x4e, 0x53, 0x53], ...int(version))
  }
  record(cmd: number, payload: number[]): this {
    const size = payload.length + 1
    this.parts.push(size & 255, size >> 8, cmd, ...payload)
    return this
  }
  ints(cmd: number, ...values: number[]): this {
    return this.record(cmd, values.flatMap(int))
  }
  nav(tab: number, index: number, url: string, title: string): this {
    const body = [
      ...int(tab),
      ...int(index),
      ...pad([...int(url.length), ...new TextEncoder().encode(url)]),
      ...pad([...int(title.length), ...[...title].flatMap((c) => [c.charCodeAt(0), 0])]),
      ...int(0) // what follows (page state, transition...) is not read
    ]
    return this.record(6, [...int(body.length), ...body])
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.parts)
  }
}
const int = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
const pad = (b: number[]): number[] => [...b, ...Array((4 - (b.length % 4)) % 4).fill(0)]

describe('chromiumSessionTabs', () => {
  test('replays windows, tab order, selected navigation and closings', () => {
    const file = new Snss()
      .ints(0, 1, 10) // tab 10 in window 1
      .ints(0, 1, 11)
      .ints(0, 2, 20) // window 2, closed later
      .ints(0, 1, 12)
      .ints(2, 10, 1) // tab 10 second, tab 11 first
      .ints(2, 11, 0)
      .ints(2, 12, 2)
      .nav(10, 0, 'https://a.example/', 'A old')
      .nav(10, 1, 'https://a.example/new', 'A new')
      .ints(7, 10, 1)
      .nav(11, 0, 'https://b.example/', 'B')
      .ints(7, 11, 0)
      .record(12, [...int(11), 1, 0, 0, 0]) // pinned
      .nav(12, 0, 'chrome://settings/', 'Settings') // a browser page stays behind
      .ints(7, 12, 0)
      .nav(20, 0, 'https://gone.example/', 'Gone')
      .ints(17, 2, 0, 0) // window 2 closed
      .bytes()
    expect(chromiumSessionTabs(file)).toEqual([
      { url: 'https://b.example/', title: 'B', pinned: true },
      { url: 'https://a.example/new', title: 'A new', pinned: false }
    ])
  })

  test('a closed tab, a popup window and a pruned history', () => {
    const file = new Snss(1)
      .ints(0, 1, 1)
      .ints(0, 1, 2)
      .ints(0, 3, 3)
      .ints(9, 3, 1) // window 3 is a popup
      .nav(1, 0, 'https://one.example/', 'One')
      .nav(1, 1, 'https://two.example/', 'Two')
      .nav(1, 2, 'https://three.example/', 'Three')
      .ints(24, 1, 0, 2) // first two pruned: Three is now at 0
      .ints(7, 1, 0)
      .nav(2, 0, 'https://closed.example/', 'Closed')
      .ints(16, 2, 0, 0)
      .nav(3, 0, 'https://popup.example/', 'Popup')
      .bytes()
    expect(chromiumSessionTabs(file).map((t) => t.title)).toEqual(['Three'])
  })

  test('pruning keeps the selected page selected', () => {
    const file = new Snss()
      .ints(0, 1, 1)
      .nav(1, 0, 'https://one.example/', 'One')
      .nav(1, 1, 'https://two.example/', 'Two')
      .nav(1, 2, 'https://three.example/', 'Three')
      .nav(1, 3, 'https://four.example/', 'Four')
      .ints(7, 1, 2) // on Three
      .ints(11, 1, 2) // the first two pruned from the front: Three is now 0
      .bytes()
    expect(chromiumSessionTabs(file)).toEqual([
      { url: 'https://three.example/', title: 'Three', pinned: false }
    ])
    const mid = new Snss()
      .ints(0, 1, 1)
      .nav(1, 0, 'https://one.example/', 'One')
      .nav(1, 1, 'https://two.example/', 'Two')
      .nav(1, 2, 'https://three.example/', 'Three')
      .ints(7, 1, 2) // on Three
      .ints(24, 1, 0, 1) // One pruned: Three is now 1
      .bytes()
    expect(chromiumSessionTabs(mid)[0].url).toBe('https://three.example/')
  })

  test('garbage, encrypted files and a cut-off tail never throw', () => {
    expect(chromiumSessionTabs(new Uint8Array([1, 2, 3]))).toEqual([])
    expect(chromiumSessionTabs(new Snss(2).ints(0, 1, 1).bytes())).toEqual([])
    const good = new Snss().ints(0, 1, 1).nav(1, 0, 'https://x.example/', 'X').ints(7, 1, 0)
    const bytes = good.record(6, [9, 9, 9]).bytes() // a navigation record too short to read
    const cut = new Uint8Array([...bytes, 200, 0, 6, 1, 2]) // claims 200 bytes, has 3
    expect(chromiumSessionTabs(cut).map((t) => t.url)).toEqual(['https://x.example/'])
  })

  test('stops at the cap', () => {
    const s = new Snss()
    for (let i = 0; i < 5; i++)
      s.ints(0, 1, i).ints(2, i, i).nav(i, 0, `https://t${i}.example/`, '')
    expect(chromiumSessionTabs(s.bytes(), 3)).toHaveLength(3)
  })
})

describe('newestChromiumSession', () => {
  test('the largest time, not the last name', () => {
    expect(newestChromiumSession(['Tabs_9', 'Session_13300', 'Session_9999', 'Apps_1'])).toBe(
      'Session_13300'
    )
    expect(newestChromiumSession(['Tabs_1'])).toBeNull()
  })
})

const text = (b: Uint8Array | null): string | null => (b ? new TextDecoder().decode(b) : null)
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))

describe('lz4Block', () => {
  test('literals only', () => {
    expect(text(lz4Block(new Uint8Array([0x50, ...ascii('hello')]), 5))).toBe('hello')
  })

  test('an overlapping match and long lengths', () => {
    // "abc", then 9 bytes copied from 3 back, then "XYZ"
    const block = new Uint8Array([0x35, ...ascii('abc'), 3, 0, 0x30, ...ascii('XYZ')])
    expect(text(lz4Block(block, 15))).toBe('abcabcabcabcXYZ')
    // 15 + 5 = 20 literals, then a match of 15 + 4 + 4 = 23 copies of the last byte
    const lits = ascii('0123456789abcdefghij')
    const long = new Uint8Array([0xff, 5, ...lits, 1, 0, 4, 0x10, ...ascii('!')])
    expect(text(lz4Block(long, 44))).toBe('0123456789abcdefghij' + 'j'.repeat(23) + '!')
  })

  test('malformed blocks give null', () => {
    expect(lz4Block(new Uint8Array([0x50, 1, 2]), 5)).toBeNull() // literals run past the end
    expect(lz4Block(new Uint8Array([0x10, 65, 9, 0]), 5)).toBeNull() // offset before the start
    expect(lz4Block(new Uint8Array([0x20, 65, 66]), 5)).toBeNull() // shorter than promised
  })
})

const mozFile = (json: string): Uint8Array => {
  const body = ascii(json)
  // one literal run: 15 in the token, then the rest of the length in 255s and a final byte
  const lens: number[] = []
  let rest = body.length - 15
  while (rest >= 255) {
    lens.push(255)
    rest -= 255
  }
  lens.push(rest)
  return new Uint8Array([...ascii('mozLz40\0'), ...int(body.length), 0xf0, ...lens, ...body])
}

describe('firefoxSessionTabs', () => {
  test('each tab at its current entry, popups and browser pages left out', () => {
    const session = {
      windows: [
        {
          tabs: [
            {
              entries: [
                { url: 'https://old.example/', title: 'Old' },
                { url: 'https://cur.example/', title: 'Current' }
              ],
              index: 2,
              pinned: true
            },
            { entries: [{ url: 'about:newtab', title: 'New Tab' }], index: 1 },
            { entries: [{ url: 'https://noindex.example/' }] }
          ]
        },
        { isPopup: true, tabs: [{ entries: [{ url: 'https://popup.example/' }], index: 1 }] }
      ]
    }
    expect(text(mozLz4(mozFile(JSON.stringify(session))))).toBe(JSON.stringify(session))
    expect(firefoxSessionTabs(mozFile(JSON.stringify(session)))).toEqual([
      { url: 'https://cur.example/', title: 'Current', pinned: true },
      { url: 'https://noindex.example/', title: '', pinned: false }
    ])
  })

  test('not mozLz4, or not JSON inside', () => {
    expect(firefoxSessionTabs(new Uint8Array(ascii('{"windows":[]}')))).toEqual([])
    expect(firefoxSessionTabs(mozFile('this is not json at all'))).toEqual([])
  })

  test('an unreadable file is null (the next one is tried), an empty session is not', () => {
    expect(readFirefoxSession(new Uint8Array(ascii('nope')))).toBeNull()
    expect(readFirefoxSession(mozFile('not json'))).toBeNull()
    expect(readFirefoxSession(mozFile('{ "windows": [ ] }'))).toEqual([])
  })

  test('the session files in the order Firefox reads them: the clean-shutdown file first', () => {
    expect(FIREFOX_SESSION_FILES[0]).toBe('sessionstore.jsonlz4')
    expect(FIREFOX_SESSION_FILES.indexOf('sessionstore-backups/recovery.jsonlz4')).toBeLessThan(
      FIREFOX_SESSION_FILES.indexOf('sessionstore-backups/previous.jsonlz4')
    )
    expect(FIREFOX_SESSION_FILES.at(-1)).toBe('sessionstore-backups/previous.jsonlz4')
  })
})

describe('shiftSelected', () => {
  test('before the gap stays, after it moves down, inside it lands at the gap', () => {
    expect(shiftSelected(1, 3, 2)).toBe(1)
    expect(shiftSelected(6, 3, 2)).toBe(4)
    expect(shiftSelected(4, 3, 2)).toBe(3)
    expect(shiftSelected(-1, 0, 2)).toBe(-1)
  })
})
