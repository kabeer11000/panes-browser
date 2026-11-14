import { describe, expect, test } from 'bun:test'
import { boardLabels, groupTitle } from './canvasLabels'

const card = (
  id: number,
  x: number,
  y: number,
  url: string,
  frame: string | null = null
): { id: number; x: number; y: number; url: string; frame: string | null } => ({
  id,
  x,
  y,
  url,
  frame
})

describe('groupTitle', () => {
  test('the site most pages are on', () => {
    expect(groupTitle(['https://github.com/a', 'https://www.github.com/b', 'https://x.com/'])).toBe(
      'github.com'
    )
  })
  test('mixed: the two most common and how many more', () => {
    expect(
      groupTitle([
        'https://a.com/',
        'https://a.com/2',
        'https://b.com/',
        'https://c.com/',
        'https://d.com/'
      ])
    ).toBe('a.com, b.com +2')
    expect(groupTitle(['https://a.com/', 'https://b.com/', 'https://c.com/'])).toBe(
      'a.com, b.com +1'
    )
  })
  test('no addresses (notes, files): a plain name', () => {
    expect(groupTitle(['', ''])).toBe('Cards')
  })
})

describe('boardLabels', () => {
  const frames = [{ id: 'f1', name: 'Trip', x: 0, y: 0, w: 1000, h: 400 }]
  test('a section is labelled with its box and count', () => {
    const [f] = boardLabels(frames, [], new Map([['f1', 4]]))
    expect(f).toEqual({
      key: 'f:f1',
      x: 0,
      y: 0,
      w: 1000,
      h: 400,
      title: 'Trip',
      count: 4,
      frame: 'f1'
    })
  })
  test('loose cards lying together get one label; a far pair and cards in sections get none', () => {
    const cards = [
      card(1, 2000, 0, 'https://github.com/1'),
      card(2, 2300, 0, 'https://github.com/2'),
      card(3, 2600, 0, 'https://news.com/'),
      card(4, 9000, 0, 'https://far.com/'),
      card(5, 9300, 0, 'https://far.com/2'),
      card(6, 10, 10, 'https://in.com/', 'f1')
    ]
    const labels = boardLabels(frames, cards, new Map())
    expect(labels).toHaveLength(2)
    expect(labels[1]).toEqual({
      key: 'g:1',
      x: 2000,
      y: 0,
      w: 840,
      h: 300,
      title: 'github.com',
      count: 3
    })
  })
  test('a card whose section is gone counts as loose', () => {
    const cards = [0, 1, 2].map((i) => card(i + 1, i * 300, 0, 'https://a.com/', 'gone'))
    expect(boardLabels([], cards, new Map())[0].count).toBe(3)
  })
})
