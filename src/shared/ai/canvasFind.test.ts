import { describe, expect, test } from 'bun:test'
import {
  addVirtual,
  addResultFrame,
  boundsOf,
  cardBox,
  emptyCards,
  emptyState,
  finishFrame,
  forDisk,
  intersects,
  isVirtual,
  reconcileSaved,
  removeVirtual,
  setItem,
  syncTabs,
  tidy,
  type CanvasState
} from './canvas'
import {
  answerLinks,
  downloadHits,
  frameLabel,
  guessIntent,
  habit,
  hitKey,
  historyHits,
  mergeHits,
  orderHits,
  parseModelIntent,
  pickResults,
  tabHits,
  termScore,
  webQuery,
  MAX_RESULTS,
  type Hit
} from './canvasFind'
import { itemFor, kindOf, posterFor, siteOf, youtubeId, excerpt } from './canvasItems'

const NOW = Date.UTC(2026, 10, 9)
const DAY = 86_400_000
const hit = (url: string, over: Partial<Hit> = {}): Hit => ({
  url,
  title: url,
  source: 'web',
  relevance: 0.8,
  ...over
})

describe('guessIntent', () => {
  test('questions are asks', () => {
    expect(guessIntent('What is the capital of France?')).toMatchObject({
      intent: 'ask',
      confident: true
    })
    expect(guessIntent('how do I cook risotto')).toMatchObject({ intent: 'ask', confident: true })
    expect(guessIntent('explain TCP slow start')).toMatchObject({ intent: 'ask', confident: true })
  })
  test('commands and short phrases are finds', () => {
    expect(guessIntent('open the rust book')).toMatchObject({
      intent: 'find',
      confident: true,
      terms: 'the rust book'
    })
    expect(guessIntent('sourdough')).toMatchObject({ intent: 'find', confident: true })
    expect(guessIntent('github.com/foo/bar')).toMatchObject({ intent: 'find', confident: true })
  })
  test('a long phrase with no question word is an unsure find', () => {
    expect(guessIntent('quarterly sales numbers for the northern region')).toMatchObject({
      intent: 'find',
      confident: false
    })
  })
  test('a question word with too few words is not confident', () => {
    expect(guessIntent('what is rust')).toMatchObject({ intent: 'ask', confident: false })
  })
  test('documents and pictures are noticed', () => {
    expect(guessIntent('find the arm cortex datasheet pdf')).toMatchObject({ wantsDocs: true })
    expect(guessIntent('photos of tokyo')).toMatchObject({ wantsImages: true })
  })
  test('empty is a confident find of nothing', () => {
    expect(guessIntent('   ')).toMatchObject({ intent: 'find', terms: '' })
  })
})

describe('parseModelIntent', () => {
  test('reads JSON and bare words, refuses nonsense', () => {
    expect(parseModelIntent('{"intent": "ask"}')).toBe('ask')
    expect(parseModelIntent('{"intent":"find"}')).toBe('find')
    expect(parseModelIntent('Question')).toBe('ask')
    expect(parseModelIntent('search')).toBe('find')
    expect(parseModelIntent('banana')).toBe(null)
    expect(parseModelIntent(null)).toBe(null)
    expect(parseModelIntent('')).toBe(null)
  })
})

describe('webQuery', () => {
  test('adds a file type only when documents are asked for, once', () => {
    expect(webQuery(guessIntent('arm datasheet pdf'))).toBe('arm datasheet pdf filetype:pdf')
    expect(webQuery(guessIntent('sourdough starter'))).toBe('sourdough starter')
    expect(webQuery({ ...guessIntent('x filetype:pdf'), wantsDocs: true })).toBe('x filetype:pdf')
  })
})

describe('scoring', () => {
  test('termScore is the share of words found, prefixes allowed', () => {
    expect(termScore('rust book', 'The Rust Programming Book')).toBe(1)
    expect(termScore('rust book', 'Rust in action')).toBe(0.5)
    expect(termScore('rus', 'Rust')).toBe(1)
    expect(termScore('', 'x')).toBe(0)
    expect(termScore('cats', 'dogs')).toBe(0)
  })
  test('habit grows with visits and fades with time, log scaled', () => {
    const fresh = habit(10, NOW, NOW)
    expect(fresh).toBeGreaterThan(habit(10, NOW - 60 * DAY, NOW))
    expect(habit(100, NOW, NOW)).toBeGreaterThan(habit(2, NOW, NOW))
    expect(habit(100, NOW, NOW)).toBeLessThan(habit(2, NOW, NOW) * 3)
    expect(habit(0, NOW, NOW)).toBe(0)
    expect(habit(5, NOW + DAY, NOW)).toBeGreaterThan(0) // a clock a little ahead is no problem
  })
})

describe('hitKey and merging', () => {
  test('one key for the same page however it is written', () => {
    const k = hitKey('https://www.example.com/a/?utm_source=x&id=2#top')
    expect(k).toBe(hitKey('https://example.com/a?id=2'))
    expect(hitKey('https://example.com/')).toBe(hitKey('https://www.example.com'))
    expect(hitKey('https://a.com/x')).not.toBe(hitKey('https://a.com/y'))
  })
  test('a duplicate keeps its place and gains what the newcomer knows', () => {
    const have = [hit('https://a.com/p', { source: 'tab', tab: 4, title: 'A' })]
    const out = mergeHits(have, [
      hit('https://www.a.com/p#x', {
        source: 'history',
        visits: 9,
        lastVisit: NOW,
        title: 'A page about a',
        snippet: 'long text'
      }),
      hit('https://b.com/q')
    ])
    expect(out.map((h) => h.url)).toEqual(['https://a.com/p', 'https://b.com/q'])
    expect(out[0]).toMatchObject({
      source: 'tab',
      tab: 4,
      visits: 9,
      title: 'A page about a',
      snippet: 'long text'
    })
  })
  test('does not change what it was given', () => {
    const have = [hit('https://a.com/p')]
    mergeHits(have, [hit('https://a.com/p', { visits: 3 })])
    expect(have[0].visits).toBeUndefined()
  })
})

describe('ordering', () => {
  test('sources keep their order and each is best first by relevance and habit', () => {
    const hits = [
      hit('https://w1.com', { source: 'web', relevance: 0.9 }),
      hit('https://h1.com', {
        source: 'history',
        relevance: 0.6,
        visits: 1,
        lastVisit: NOW - 90 * DAY
      }),
      hit('https://h2.com', {
        source: 'history',
        relevance: 0.6,
        visits: 40,
        lastVisit: NOW - DAY
      }),
      hit('https://t1.com', { source: 'tab', relevance: 0.5, tab: 1 }),
      hit('file:///d.pdf', { source: 'download', relevance: 0.7, file: 'd.pdf' })
    ]
    expect(orderHits(hits, NOW).map((h) => h.url)).toEqual([
      'https://t1.com',
      'https://h2.com',
      'https://h1.com',
      'file:///d.pdf',
      'https://w1.com'
    ])
  })
  test('pickResults dedupes across sources, keeps the first source, and caps', () => {
    const tab = [hit('https://a.com/x', { source: 'tab', tab: 2, relevance: 0.7 })]
    const web = [
      hit('https://a.com/x', { source: 'web', relevance: 0.9 }),
      ...Array.from({ length: 30 }, (_, i) => hit(`https://w.com/${i}`))
    ]
    const out = pickResults([tab, web], NOW)
    expect(out.length).toBe(MAX_RESULTS)
    expect(out[0]).toMatchObject({ source: 'tab', tab: 2 })
    expect(out.filter((h) => h.url.includes('a.com/x')).length).toBe(1)
  })
  test('is stable for equal scores', () => {
    const hits = ['a', 'b', 'c'].map((x) => hit(`https://${x}.com`))
    expect(orderHits(hits, NOW).map((h) => h.url)).toEqual(hits.map((h) => h.url))
  })
})

describe('local sources', () => {
  test('tabs: the title or the address must cover enough of the words', () => {
    const tabs = [
      { id: 1, url: 'https://doc.rust-lang.org/book', title: 'The Rust Programming Language' },
      { id: 2, url: 'https://news.com', title: 'News' }
    ]
    expect(tabHits('rust book', tabs).map((h) => h.tab)).toEqual([1])
    expect(tabHits('cooking', tabs)).toEqual([])
  })
  test('history: visits are counted per page and the last visit kept', () => {
    const e = [
      { url: 'https://a.com/x', title: 'Sourdough guide', time: 5 },
      { url: 'https://a.com/x#y', title: 'Sourdough guide', time: 9 },
      { url: 'https://b.com', title: 'Other', time: 1 },
      { url: 'panes://history', title: 'Sourdough', time: 2 }
    ]
    const h = historyHits('sourdough', e)
    expect(h.length).toBe(1)
    expect(h[0]).toMatchObject({ visits: 2, lastVisit: 9, source: 'history' })
  })
  test('downloads: matched by file name, returned as a file address', () => {
    const h = downloadHits('arm datasheet', [
      {
        filename: 'ARM_Cortex-M4_datasheet.pdf',
        savePath: 'C:\\Users\\me\\Downloads\\ARM_Cortex-M4_datasheet.pdf',
        url: 'https://x.com/a.pdf',
        time: 1
      },
      { filename: 'photo.jpg', savePath: 'C:\\p.jpg', url: 'https://x.com/p.jpg', time: 1 }
    ])
    expect(h.length).toBe(1)
    expect(h[0].url).toBe('file:///C:/Users/me/Downloads/ARM_Cortex-M4_datasheet.pdf')
    expect(h[0].file).toContain('Downloads')
  })
})

describe('answers', () => {
  test('links come out once each, markdown first', () => {
    const t =
      'See [the book](https://doc.rust-lang.org/book/) and https://doc.rust-lang.org/book, also https://x.com/a.'
    const l = answerLinks(t)
    expect(l.map((x) => x.url)).toEqual(['https://doc.rust-lang.org/book/', 'https://x.com/a'])
    expect(l[0].title).toBe('the book')
  })
  test('ignores non-web links and caps the number', () => {
    expect(answerLinks('[x](javascript:alert(1)) [y](ftp://z)')).toEqual([])
    const many = Array.from({ length: 20 }, (_, i) => `https://s.com/${i}`).join(' ')
    expect(answerLinks(many).length).toBe(6)
  })
  test('frame labels are short', () => {
    expect(frameLabel('  find   my   notes ')).toBe('find my notes')
    expect(frameLabel('x'.repeat(100)).length).toBeLessThanOrEqual(34)
    expect(frameLabel('')).toBe('Results')
  })
})

describe('card kinds', () => {
  test('by MIME type first, then extension, then site', () => {
    expect(kindOf('https://a.com/x', 'application/pdf')).toBe('pdf')
    expect(kindOf('https://a.com/x.PDF')).toBe('pdf')
    expect(kindOf('https://a.com/x.pdf?download=1#p=2')).toBe('pdf')
    expect(kindOf('https://a.com/pic.jpeg')).toBe('image')
    expect(kindOf('https://a.com/x', 'image/webp; charset=x')).toBe('image')
    expect(kindOf('file:///C:/Users/me/Downloads/a%20b.png')).toBe('image')
    expect(kindOf('https://a.com/v.mp4')).toBe('video')
    expect(kindOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('video')
    expect(kindOf('https://youtu.be/dQw4w9WgXcQ')).toBe('video')
    expect(kindOf('https://www.youtube.com/@channel')).toBe('page')
    expect(kindOf('https://vimeo.com/123456')).toBe('video')
    expect(kindOf('https://example.com/article')).toBe('page')
    expect(kindOf('not an address')).toBe('page')
  })
  test('youtube ids and posters', () => {
    expect(youtubeId('https://www.youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk')
    expect(youtubeId('https://www.youtube.com/watch?v=short')).toBe(null)
    expect(posterFor('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    )
    expect(posterFor('https://vimeo.com/1')).toBe(null)
  })
  test('items know their site, a picture is its own image', () => {
    expect(siteOf('https://www.example.com/a')).toBe('example.com')
    expect(siteOf('file:///C:/a.pdf')).toBe('This computer')
    expect(itemFor('https://a.com/p.png', '')).toMatchObject({
      kind: 'image',
      image: 'https://a.com/p.png',
      title: 'a.com'
    })
    expect(itemFor('https://youtu.be/dQw4w9WgXcQ', 'Clip')).toMatchObject({ kind: 'video' })
  })
  test('excerpt cuts at a word', () => {
    expect(excerpt('word '.repeat(100), 50).endsWith('...')).toBe(true)
    expect(excerpt('short text')).toBe('short text')
  })
})

// ---- result frames ----

const clean = (s: CanvasState): void => {
  const boxes = [...s.frames, ...s.notes]
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) expect(intersects(boxes[i], boxes[j])).toBe(false)
  for (let i = 0; i < s.cards.length; i++)
    for (let j = i + 1; j < s.cards.length; j++)
      expect(intersects(cardBox(s.cards[i]), cardBox(s.cards[j]))).toBe(false)
}
const base = (): CanvasState =>
  tidy(
    emptyState('b'),
    Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      url: `https://s${i}.com/p`,
      private: false
    })),
    [
      { name: 'A', ids: [1, 2, 3, 4, 5] },
      { name: 'B', ids: [6, 7, 8, 9] }
    ]
  )

describe('result frames', () => {
  test('a new frame with placeholders lands clear of everything, even on top of a frame', () => {
    const s = base()
    const f = s.frames[0]
    const r = addResultFrame(s, 'Results for sourdough', 6, { x: f.x + 10, y: f.y + 10 })
    expect(r.ids.length).toBe(6)
    expect(r.ids.every(isVirtual)).toBe(true)
    expect(new Set(r.ids).size).toBe(6)
    clean(r.state)
    expect(r.state.frames.find((x) => x.id === r.frameId)?.kind).toBe('result')
  })
  test('several frames in a row never overlap', () => {
    let s = base()
    for (let i = 0; i < 5; i++) s = addResultFrame(s, `q${i}`, 4 + i, { x: 300, y: 300 }).state
    clean(s)
    expect(new Set(s.cards.map((c) => c.id)).size).toBe(s.cards.length)
  })
  test('is deterministic', () => {
    expect(addResultFrame(base(), 'q', 6, { x: 0, y: 0 })).toEqual(
      addResultFrame(base(), 'q', 6, { x: 0, y: 0 })
    )
  })
  test('fill, then finish: empty cards go and the frame fits what came', () => {
    let s = base()
    const r = addResultFrame(s, 'q', 8, { x: 0, y: 0 })
    s = r.state
    const item = (n: number): ReturnType<typeof itemFor> => itemFor(`https://r.com/${n}`, `R${n}`)
    r.ids.slice(0, 3).forEach((id, n) => (s = setItem(s, id, item(n))))
    expect(emptyCards(s, r.frameId).length).toBe(5)
    s = finishFrame(s, r.frameId)
    expect(s.cards.filter((c) => c.frame === r.frameId).length).toBe(3)
    expect(Object.keys(s.items).length).toBe(3)
    clean(s)
  })
  test('finishing a frame nothing came for removes it', () => {
    const r = addResultFrame(base(), 'q', 4, { x: 0, y: 0 })
    const s = finishFrame(r.state, r.frameId)
    expect(s.frames.some((f) => f.id === r.frameId)).toBe(false)
    expect(s.cards.some((c) => isVirtual(c.id))).toBe(false)
  })
  test('answers add cards to a frame', () => {
    let s = addResultFrame(base(), 'Answer', 1, { x: 0, y: 0 })
    const a = addVirtual(s.state, s.frameId, itemFor('https://a.com', 'A'))
    expect(a.id).toBeLessThan(0)
    clean(a.state)
    expect(a.state.cards.filter((c) => c.frame === s.frameId).length).toBe(2)
    s = { ...s, state: a.state }
  })
  test('tidy up leaves result frames and their cards alone, rearranging too', () => {
    let s = base()
    const r = addResultFrame(s, 'q', 3, { x: 0, y: 0 })
    s = r.state
    r.ids.forEach((id, n) => (s = setItem(s, id, itemFor(`https://r.com/${n}`, 'R'))))
    const frame = s.frames.find((f) => f.id === r.frameId)!
    const tabs = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      url: `https://s${i}.com/p`,
      private: false
    }))
    for (const rearrange of [false, true]) {
      const t = tidy(s, tabs, [{ name: 'All', ids: [1, 2, 3, 4, 5, 6] }], rearrange)
      expect(t.frames.find((f) => f.id === r.frameId)).toEqual(frame)
      expect(t.cards.filter((c) => isVirtual(c.id)).length).toBe(3)
      clean(t)
    }
  })
  test('syncing tabs and saving keep them; private tabs still never reach disk', () => {
    let s = base()
    const r = addResultFrame(s, 'q', 2, { x: 0, y: 0 })
    s = r.state
    r.ids.forEach((id, n) => (s = setItem(s, id, itemFor(`https://r.com/${n}`, 'R'))))
    const tabs = [
      ...Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        url: `https://s${i}.com/p`,
        private: false
      })),
      { id: 99, url: 'https://secret.example/x', private: true }
    ]
    s = syncTabs(s, tabs).state
    expect(s.cards.filter((c) => isVirtual(c.id)).length).toBe(2)
    const d = forDisk(s)
    expect(JSON.stringify(d)).not.toContain('secret.example')
    expect(Object.keys(d.items).length).toBe(2)
    const back = reconcileSaved(d, tabs, 'other-run')
    expect(back.cards.filter((c) => isVirtual(c.id)).length).toBe(2)
    expect(Object.keys(back.items).length).toBe(2)
    expect(boundsOf(back.frames)).not.toBe(null)
  })
  test('removing a card removes what it held; an emptied result frame goes', () => {
    let s = base()
    const r = addResultFrame(s, 'q', 1, { x: 0, y: 0 })
    s = setItem(r.state, r.ids[0], itemFor('https://r.com', 'R'))
    s = removeVirtual(s, r.ids)
    expect(s.items).toEqual({})
    expect(s.frames.some((f) => f.id === r.frameId)).toBe(false)
  })
})
