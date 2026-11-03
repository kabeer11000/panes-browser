import { describe, expect, test } from 'bun:test'
import {
  CANARY,
  LIST_IDS,
  decide,
  packEngines,
  unpackEngines,
  pickLists,
  preprocess,
  requestType,
  sameSite,
  type CatalogEntry,
  type EngineResult
} from './adblock'

describe('pickLists', () => {
  const catalog: CatalogEntry[] = [
    {
      uuid: 'default',
      title: 'Brave Default Adblock Filters',
      first_party_protections: true,
      permission_mask: 1,
      sources: [{ url: 'https://a/filters.txt', title: 'uBO' }, { url: 'https://a/easylist.txt' }]
    },
    {
      uuid: LIST_IDS[1],
      first_party_protections: true,
      permission_mask: 1,
      sources: [{ url: 'https://a/easyprivacy.txt' }, { url: 'https://a/filters.txt' }]
    },
    {
      uuid: LIST_IDS[2],
      title: 'First Party',
      permission_mask: 1,
      sources: [{ url: 'https://a/fp.txt' }]
    },
    { uuid: 'cookies', sources: [{ url: 'https://a/cookies.txt' }] }
  ]

  test('only the chosen entries, no duplicate urls, first party flag from the catalog', () => {
    const lists = pickLists(catalog)
    expect(lists.map((l) => l.url)).toEqual([
      'https://a/filters.txt',
      'https://a/easylist.txt',
      'https://a/easyprivacy.txt',
      'https://a/fp.txt'
    ])
    expect(lists.filter((l) => l.firstParty).map((l) => l.url)).toEqual(['https://a/fp.txt'])
    expect(lists.every((l) => l.permissions === 1)).toBe(true)
  })

  test('a catalog missing a wanted entry fails instead of building a thinner engine', () => {
    expect(() => pickLists(catalog.slice(1))).toThrow()
  })
})

describe('preprocess', () => {
  const run = (lines: string[]): string[] =>
    preprocess(lines.join('\n')).split('\n').filter(Boolean)

  test('keeps Chromium lines, drops Firefox ones and the directives', () => {
    expect(
      run([
        'a',
        '!#if env_chromium',
        'b',
        '!#endif',
        '!#if env_firefox',
        'c',
        '!#else',
        'd',
        '!#endif',
        'e'
      ])
    ).toEqual(['a', 'b', 'd', 'e'])
  })

  test('negation and nesting', () => {
    expect(run(['!#if !env_firefox', 'a', '!#if env_safari', 'b', '!#endif', '!#endif'])).toEqual([
      'a'
    ])
    expect(
      run(['!#if env_firefox', '!#if env_chromium', 'a', '!#else', 'b', '!#endif', '!#endif'])
    ).toEqual([])
  })

  test('an unknown token keeps both sides, as Brave does', () => {
    expect(run(['!#if env_mobile', 'a', '!#else', 'b', '!#endif'])).toEqual(['a', 'b'])
  })

  test('unbalanced directives throw', () => {
    expect(() => preprocess('!#if env_chromium\na')).toThrow()
    expect(() => preprocess('a\n!#endif')).toThrow()
  })
})

describe('requestType', () => {
  test('maps Electron names, anything else is other', () => {
    expect(requestType('subFrame')).toBe('subdocument')
    expect(requestType('xhr')).toBe('xmlhttprequest')
    expect(requestType('somethingNew')).toBe('other')
  })
})

describe('sameSite', () => {
  test('uses the public suffix list, private registries included', () => {
    expect(sameSite('https://cdn.bbc.co.uk/x.js', 'https://www.bbc.co.uk/')).toBe(true)
    expect(sameSite('https://a.github.io/', 'https://b.github.io/')).toBe(false)
    expect(sameSite('https://ads.example.com/', 'https://other.com/')).toBe(false)
    expect(sameSite('http://127.0.0.1:3000/a', 'http://127.0.0.1:3000/')).toBe(true)
    expect(sameSite('not a url', 'https://a.com')).toBe(false)
  })
})

describe('decide', () => {
  const req = (
    over: Partial<{ url: string; method: string; type: string }> = {}
  ): {
    url: string
    method: string
    type: string
  } => ({ url: 'https://ads.com/a.js', method: 'GET', type: 'script', ...over })

  const asked: string[] = []
  const engine =
    (result: EngineResult) =>
    (which: 'all' | 'firstParty'): EngineResult => {
      asked.push(which)
      return result
    }

  test('Standard: own requests only answer to the first-party lists, others to everything', () => {
    asked.length = 0
    decide(req(), true, false, engine({}))
    decide(req(), false, false, engine({}))
    decide(req(), true, true, engine({}))
    expect(asked).toEqual(['firstParty', 'all', 'all'])
  })

  test('block, redirect to a stub, rewrite only for safe methods, never the page itself', () => {
    expect(decide(req(), false, false, engine({ should_block: true }))).toEqual({
      blocked: true,
      response: { cancel: true }
    })
    expect(
      decide(
        req(),
        false,
        false,
        engine({ should_block: true, redirect: 'data:text/javascript;base64,' })
      )
    ).toEqual({ blocked: true, response: { redirectURL: 'data:text/javascript;base64,' } })
    const rewrite = engine({ rewritten_url: 'https://ads.com/a.js?x' })
    expect(decide(req(), false, false, rewrite)).toEqual({
      blocked: false,
      response: { redirectURL: 'https://ads.com/a.js?x' }
    })
    expect(decide(req({ method: 'POST' }), false, false, rewrite)).toBeNull()
    expect(
      decide(req({ type: 'document' }), false, false, engine({ should_block: true }))
    ).toBeNull()
  })
})

describe('packEngines', () => {
  test('round trip, and a damaged file is refused', () => {
    const a = new Uint8Array([1, 2, 3]).buffer
    const b = new Uint8Array([]).buffer
    const packed = packEngines([a, b, '[{"name":"x"}]'])
    const [ra, rb, rs] = unpackEngines(packed)
    expect(Array.from(new Uint8Array(ra))).toEqual([1, 2, 3])
    expect(rb.byteLength).toBe(0)
    expect(rs).toBe('[{"name":"x"}]')
    expect(() => unpackEngines(packed.slice(0, packed.length - 1))).toThrow()
    expect(() => unpackEngines(new Uint8Array([...packed, 0]))).toThrow()
  })
})

test('the canary has both kinds of request', () => {
  expect(CANARY.some((c) => c.block)).toBe(true)
  expect(CANARY.some((c) => !c.block)).toBe(true)
})
