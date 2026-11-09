import { describe, expect, test } from 'bun:test'
import { parseInline, parseMarkdown, type Block, type Inline } from './markdown'

const flat = (n: Inline[]): string =>
  n.map((x) => (x.t === 'text' || x.t === 'code' ? x.text : flat(x.children))).join('')
const allText = (n: Inline[]): boolean => n.every((x) => x.t === 'text')

describe('inline', () => {
  test('code, bold and italic', () => {
    const kinds = parseInline('a `b` **c** *d*').map((x) => x.t)
    expect(kinds).toEqual(['text', 'code', 'text', 'strong', 'text', 'em'])
  })

  test('unclosed marks stay as text while streaming', () => {
    expect(flat(parseInline('half **bold'))).toBe('half **bold')
    expect(allText(parseInline('half **bold'))).toBe(true)
    expect(allText(parseInline('a `code'))).toBe(true)
  })

  test('snake_case and stars in math are not emphasis', () => {
    expect(allText(parseInline('use my_var_name now'))).toBe(true)
    expect(allText(parseInline('2 * 3 * 4'))).toBe(true)
  })

  test('only web links become links; the rest keep their words', () => {
    expect(parseInline('[site](https://a.com/x)')[0]).toMatchObject({
      t: 'link',
      href: 'https://a.com/x'
    })
    for (const bad of ['javascript:void', 'file:///c:/x', 'panes://settings']) {
      const r = parseInline(`[click](${bad})`)
      expect(r.some((x) => x.t === 'link')).toBe(false)
      expect(flat(r)).toBe('click')
    }
  })

  test('raw HTML is just text', () => {
    const r = parseInline('<img src=x onerror=alert(1)> <script>x</script>')
    expect(allText(r)).toBe(true)
    expect(flat(r)).toContain('<script>')
  })
})

describe('blocks', () => {
  test('paragraphs, headings, lists and quotes', () => {
    const b = parseMarkdown('# T\n\nline one\nline two\n\n- a\n- b\n\n1. x\n2. y\n\n> q')
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'list', 'list', 'quote'])
    expect((b[2] as Extract<Block, { t: 'list' }>).items).toHaveLength(2)
    expect((b[3] as Extract<Block, { t: 'list' }>).ordered).toBe(true)
    expect(flat((b[1] as Extract<Block, { t: 'p' }>).children)).toBe('line one line two')
  })

  test('fenced code is kept verbatim, and an open fence runs to the end', () => {
    const b = parseMarkdown('```ts\nconst a = **1**\n```\nafter')
    expect(b[0]).toEqual({ t: 'code', lang: 'ts', text: 'const a = **1**' })
    expect(b[1].t).toBe('p')
    expect(parseMarkdown('```\nstill typing')[0]).toEqual({
      t: 'code',
      lang: '',
      text: 'still typing'
    })
  })

  test('empty and whitespace input give nothing', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('  \n \n')).toEqual([])
  })

  test('very deep nesting does not run away', () => {
    expect(() => parseInline('*'.repeat(2000) + 'x' + '*'.repeat(2000))).not.toThrow()
  })
})
