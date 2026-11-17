import { describe, expect, test } from 'bun:test'
import {
  answerShape,
  fallbackSummary,
  placeItem,
  pagesNotDocuments,
  suggestPlacement
} from './canvasPlace'
import { itemFor } from './canvasItems'

describe('suggestPlacement', () => {
  test('answers are notes; pdf, image and video are themselves', () => {
    expect(suggestPlacement({ kind: 'answer', url: '' })).toBe('note')
    for (const [kind, url] of [
      ['pdf', 'https://a.com/x.pdf'],
      ['image', 'https://a.com/x.png'],
      ['video', 'https://youtu.be/dQw4w9WgXcQ']
    ] as const)
      expect(suggestPlacement({ kind, url })).toBe('document')
  })
  test('every web page is the page, never its text as a reader', () => {
    for (const url of [
      'https://en.wikipedia.org/wiki/Mars',
      'https://blog.example.com/2026/post-title',
      'https://mail.google.com/mail/u/0/',
      'https://example.com/',
      'not a url'
    ])
      expect(suggestPlacement({ kind: 'page', url })).toBe('live')
  })
})

describe('answers and models', () => {
  test('shapes', () => {
    expect(answerShape('what is rust')).toBe('definition')
    expect(answerShape('rust vs go')).toBe('comparison')
    expect(answerShape('how to bake bread')).toBe('howto')
    expect(answerShape('is it raining')).toBe('question')
  })
})

describe('placeItem', () => {
  const page = itemFor('https://en.wikipedia.org/wiki/Mars', 'Mars', {
    text: 'Mars is the fourth planet from the Sun. It is red.'
  })
  test('page to note: text with a source link, no tab, original untouched', () => {
    const n = placeItem(page, 'note', '- Fourth planet\n- Red')
    expect(n).toMatchObject({ kind: 'answer', placement: 'note' })
    expect(n.text).toContain('- Fourth planet')
    expect(n.text).toContain('[en.wikipedia.org](https://en.wikipedia.org/wiki/Mars)')
    expect(n.tab).toBeUndefined()
    expect(page.kind).toBe('page')
  })
  test('note back to document goes back to what the address is', () => {
    const n = placeItem(page, 'note', 's')
    expect(placeItem(n, 'document').kind).toBe('page')
    expect(
      placeItem(placeItem(itemFor('https://a.com/x.pdf', 'X'), 'note', 's'), 'document').kind
    ).toBe('pdf')
    expect(placeItem(n, 'live')).toMatchObject({ kind: 'page', placement: 'live' })
  })
  test('an answer stays itself as a note', () => {
    const a = { kind: 'answer' as const, url: '', title: 'q', site: '', text: 'hi' }
    expect(placeItem(a, 'note')).toMatchObject({ kind: 'answer', placement: 'note', text: 'hi' })
  })
  test('fallbackSummary makes bullets from sentences', () => {
    expect(
      fallbackSummary(
        'This is a long enough first sentence here. And this is a second long sentence too.'
      )
    ).toBe(
      '- This is a long enough first sentence here.\n- And this is a second long sentence too.'
    )
    expect(fallbackSummary('short')).toBe('short')
  })
})

describe('pagesNotDocuments', () => {
  test('a web page saved as a document is the page again; a PDF stays a document', () => {
    const page = {
      ...itemFor('https://en.wikipedia.org/wiki/Mars', 'Mars'),
      placement: 'document' as const
    }
    const pdf = {
      ...itemFor('https://a.com/x.pdf', 'X', { kind: 'pdf' }),
      placement: 'document' as const
    }
    const s = pagesNotDocuments({ items: { '1': page, '2': pdf } })
    expect(s.items['1'].placement).toBe('live')
    expect(s.items['2'].placement).toBe('document')
  })
  test('a board with nothing to change comes back as it was', () => {
    const s = { items: { '1': { ...itemFor('https://a.com/', 'A'), placement: 'live' as const } } }
    expect(pagesNotDocuments(s)).toBe(s)
  })
})
