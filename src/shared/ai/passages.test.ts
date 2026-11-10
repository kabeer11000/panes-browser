import { describe, expect, test } from 'bun:test'
import { chunks, cutPage, scores, words } from './passages'

const para = (topic: string, n = 8): string =>
  Array.from({ length: n }, (_, i) => `Sentence ${i} is about ${topic} and nothing else.`).join(' ')

// a long article: filler paragraphs with one about the 1998 flood deep in the middle
const article = [
  para('the town founding'),
  ...Array.from({ length: 30 }, (_, i) => para(`farming season ${i}`)),
  'The great flood of 1998 reached 4.2 metres at the bridge and forced 3,000 people from their homes.',
  ...Array.from({ length: 30 }, (_, i) => para(`market day ${i}`))
].join('\n')

describe('words', () => {
  test('lowercases, keeps letters and digits in any script, drops filler', () => {
    expect(words('What did the Flood of 1998 do?')).toEqual(['flood', '1998'])
    expect(words('Überschwemmung 東京 é')).toEqual(['überschwemmung', '東京'])
  })
})

describe('chunks', () => {
  test('covers the text, each piece about the size, broken at line ends', () => {
    const c = chunks(article, 600)
    expect(c.every((p) => p.length <= 600)).toBe(true)
    expect(c.join('').replace(/\s/g, '')).toBe(article.replace(/\s/g, ''))
  })
  test('a text with no line or sentence ends is still cut', () => {
    expect(chunks('x'.repeat(1500), 600).map((p) => p.length)).toEqual([600, 600, 300])
  })
})

describe('scores', () => {
  test('ranks the passage with the rare question words first', () => {
    const c = chunks(article)
    const s = scores(c, 'how high was the flood in 1998?')
    const best = s.indexOf(Math.max(...s))
    expect(c[best]).toContain('4.2 metres')
  })
  test('no telling words: all zero', () => {
    expect(scores(['a b', 'c d'], 'summarise this page')).toEqual([0, 0])
  })
})

describe('cutPage', () => {
  test('a page that fits is kept whole', () => {
    expect(cutPage('short page', 'q', 1000)).toEqual({ lead: 'short page', extra: '', cut: false })
  })

  test('the opening is the same whatever is asked (cacheable), the rest follows the question', () => {
    const a = cutPage(article, 'how high was the flood in 1998?', 4000)
    const b = cutPage(article, 'what happens on market day 17?', 4000)
    expect(a.cut).toBe(true)
    expect(a.lead).toBe(b.lead)
    expect(a.lead).toContain('town founding')
    expect(a.lead).not.toContain('4.2 metres')
    expect(a.extra).toContain('4.2 metres')
    expect(b.extra).toContain('market day 17')
    expect(a.lead.length + a.extra.length).toBeLessThanOrEqual(4000)
  })

  test('a summary request spreads over the whole page', () => {
    const c = cutPage(article, 'summarise this', 6000)
    expect(c.extra).toContain('farming season')
    expect(c.extra).toContain('market day 2')
  })

  test('passages stay in page order', () => {
    const c = cutPage(article, 'market day 3 and farming season 25', 6000)
    const parts = c.extra.split('\n...\n')
    const at = parts.map((p) => article.indexOf(p.slice(0, 40)))
    expect(at).toEqual([...at].sort((x, y) => x - y))
  })
})
