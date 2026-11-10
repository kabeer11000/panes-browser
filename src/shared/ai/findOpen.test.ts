import { describe, expect, test } from 'bun:test'
import { isPdfUrl, keyWords, pickResult, searchFor, wantsPdf } from './findOpen'
import { quickCommand } from './commands'

const r = (
  url: string,
  title: string,
  snippet = ''
): { url: string; title: string; snippet: string } => ({
  url,
  title,
  snippet
})

describe('find X and open it', () => {
  test('a PDF is asked for by the word, and searched for as a file', () => {
    expect(wantsPdf('dragon book of compilers pdf')).toBe(true)
    expect(wantsPdf('dragon book of compilers')).toBe(false)
    expect(searchFor('dragon book  of compilers pdf')).toBe(
      'dragon book of compilers pdf filetype:pdf'
    )
    expect(searchFor('rust book')).toBe('rust book')
    expect(keyWords('find the dragon book of compilers pdf')).toEqual([
      'dragon',
      'book',
      'compilers'
    ])
  })
  test('the PDF itself beats pages about it, and sign-in walls lose', () => {
    const results = [
      r(
        'https://www.amazon.com/Compilers-Principles/dp/0321486811',
        'Compilers: Principles, Techniques (Dragon Book)'
      ),
      r('https://www.scribd.com/doc/1/dragon-book.pdf', 'Dragon book compilers pdf'),
      r(
        'https://example.edu/~cs/dragon-book-compilers.pdf?dl=1',
        'Compilers Principles Techniques and Tools'
      ),
      r(
        'https://en.wikipedia.org/wiki/Compilers:_Principles,_Techniques,_and_Tools',
        'Dragon Book - Wikipedia'
      )
    ]
    expect(isPdfUrl(results[2].url)).toBe(true)
    expect(pickResult(results, 'dragon book of compilers pdf')?.url).toBe(results[2].url)
  })
  test('without "pdf" the best named result wins, in the engine order on a tie', () => {
    const results = [
      r('https://doc.rust-lang.org/book/', 'The Rust Programming Language'),
      r('https://www.pinterest.com/pin/1', 'Rust book cover ideas'),
      r('https://example.com/rust-book', 'The Rust book')
    ]
    // both name "rust" and "book" (the first in its address): the engine's first wins; the pin never does
    expect(pickResult(results, 'the rust book')?.url).toBe(results[0].url)
    expect(pickResult(results.slice(1), 'the rust book')?.url).toBe(results[2].url)
    expect(pickResult(results, 'rust programming language')?.url).toBe(results[0].url)
  })
  test('nothing that names any of the words is opened', () => {
    expect(pickResult([r('https://a.com/', 'Cooking tips')], 'dragon book pdf')).toBeNull()
    expect(pickResult([], 'anything')).toBeNull()
    expect(pickResult([r('javascript:alert(1)', 'dragon book')], 'dragon book')).toBeNull()
  })
})

describe('find X and open it, said plainly', () => {
  test('is carried out without a model', () => {
    const q = (s: string): unknown => quickCommand(s, [])
    expect(q('find dragon book of compilers pdf and open')).toMatchObject({
      call: { name: 'find_and_open', query: 'dragon book of compilers pdf' }
    })
    expect(q('can you find me the rust book and open it')).toMatchObject({
      call: { name: 'find_and_open', query: 'the rust book' }
    })
    expect(q('search for attention is all you need, then open the first result')).toMatchObject({
      call: { name: 'find_and_open', query: 'attention is all you need' }
    })
    expect(q('open the dragon book pdf')).toMatchObject({
      call: { name: 'find_and_open', query: 'dragon book pdf' }
    })
    // anything else is left to the model
    expect(q('find the cheapest flight and book it')).toBeNull()
    expect(q('open github')).toBeNull()
  })
})
