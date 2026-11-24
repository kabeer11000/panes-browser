import { expect, test } from 'bun:test'
import { highlightLink } from './textFragment'

test('a short selection is quoted whole, its special characters escaped', () => {
  expect(highlightLink('https://example.com/a#top', 'Fast, safe - and  small')).toBe(
    'https://example.com/a#:~:text=Fast%2C%20safe%20%2D%20and%20small'
  )
})

test('a long selection is named by its first and last words', () => {
  const words = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')
  expect(highlightLink('https://example.com/', words)).toBe(
    'https://example.com/#:~:text=w0%20w1%20w2%20w3%20w4,w25%20w26%20w27%20w28%20w29'
  )
})

test('nothing for non-web pages or an empty selection', () => {
  expect(highlightLink('file:///C:/a.html', 'text')).toBeNull()
  expect(highlightLink('panes://history', 'text')).toBeNull()
  expect(highlightLink('https://example.com/', '   ')).toBeNull()
  expect(highlightLink('not a url', 'text')).toBeNull()
})
