import { describe, expect, test } from 'bun:test'
import {
  answerShape,
  fallbackSummary,
  parsePlacement,
  placeItem,
  suggestPlacement
} from './canvasPlace'
import { itemFor } from './canvasItems'

describe('suggestPlacement', () => {
  test('answers are notes', () => {
    expect(suggestPlacement({ kind: 'answer', url: '' })).toEqual({
      placement: 'note',
      confident: true
    })
  })
  test('pdf, image and video are documents', () => {
    for (const [kind, url] of [
      ['pdf', 'https://a.com/x.pdf'],
      ['image', 'https://a.com/x.png'],
      ['video', 'https://youtu.be/dQw4w9WgXcQ']
    ] as const)
      expect(suggestPlacement({ kind, url })).toEqual({ placement: 'document', confident: true })
  })
  test('tools are live pages', () => {
    for (const url of [
      'https://mail.google.com/mail/u/0/',
      'https://docs.google.com/document/d/1/edit',
      'https://app.example.com/x',
      'https://example.com/dashboard/home',
      'https://www.notion.so/team'
    ])
      expect(suggestPlacement({ kind: 'page', url })).toEqual({
        placement: 'live',
        confident: true
      })
  })
  test('articles are documents', () => {
    expect(suggestPlacement({ kind: 'page', url: 'https://en.wikipedia.org/wiki/Mars' })).toEqual({
      placement: 'document',
      confident: true
    })
    expect(
      suggestPlacement({ kind: 'page', url: 'https://blog.example.com/2026/post-title' })
    ).toEqual({ placement: 'document', confident: true })
  })
  test('unknown fronts and app-like pages are not confident', () => {
    expect(suggestPlacement({ kind: 'page', url: 'https://example.com/' })).toEqual({
      placement: 'document',
      confident: false
    })
    expect(suggestPlacement({ kind: 'page', url: 'https://x.example/tool', app: true })).toEqual({
      placement: 'live',
      confident: false
    })
    expect(suggestPlacement({ kind: 'page', url: 'not a url' }).confident).toBe(false)
  })
})

describe('answers and models', () => {
  test('shapes', () => {
    expect(answerShape('what is rust')).toBe('definition')
    expect(answerShape('rust vs go')).toBe('comparison')
    expect(answerShape('how to bake bread')).toBe('howto')
    expect(answerShape('is it raining')).toBe('question')
  })
  test('parsePlacement', () => {
    expect(parsePlacement('{"placement": "live"}')).toBe('live')
    expect(parsePlacement('Note')).toBe('note')
    expect(parsePlacement('banana')).toBe(null)
    expect(parsePlacement(null)).toBe(null)
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
