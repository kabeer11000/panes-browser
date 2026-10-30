import { describe, expect, test } from 'bun:test'
import { BULK_OPEN_MAX, NONE, all, between, bulkOpenList, click } from './selection'

const order = [10, 11, 12, 13, 14]
const none = { shift: false, ctrl: false }

describe('between', () => {
  test('covers the run in either direction', () => {
    expect(between(order, 11, 13)).toEqual([11, 12, 13])
    expect(between(order, 13, 11)).toEqual([11, 12, 13])
    expect(between(order, 12, 12)).toEqual([12])
  })

  test('an unknown end falls back to the clicked row alone', () => {
    expect(between(order, 99, 12)).toEqual([12])
  })
})

describe('click', () => {
  test('a plain click toggles that row and anchors there', () => {
    const one = click(NONE, order, 11, none)
    expect([...one.ids]).toEqual([11])
    expect(one.anchor).toBe(11)
    const off = click(one, order, 11, none)
    expect(off.ids.size).toBe(0)
  })

  test('Ctrl toggles rows independently', () => {
    let s = click(NONE, order, 10, { shift: false, ctrl: true })
    s = click(s, order, 13, { shift: false, ctrl: true })
    expect([...s.ids].sort()).toEqual([10, 13])
  })

  test('Shift selects the run from the anchor and can be re-stretched', () => {
    let s = click(NONE, order, 11, none)
    s = click(s, order, 13, { shift: true, ctrl: false })
    expect([...s.ids].sort()).toEqual([11, 12, 13])
    s = click(s, order, 12, { shift: true, ctrl: false })
    expect([...s.ids].sort()).toEqual([11, 12])
  })

  test('Ctrl+Shift adds the run to what is already selected', () => {
    let s = click(NONE, order, 10, none)
    s = click(s, order, 13, { shift: false, ctrl: true })
    s = click(s, order, 14, { shift: true, ctrl: true })
    expect([...s.ids].sort()).toEqual([10, 13, 14])
  })

  test('Shift with nothing to extend from just selects the row', () => {
    const s = click(NONE, order, 12, { shift: true, ctrl: false })
    expect([...s.ids]).toEqual([12])
  })
})

describe('all', () => {
  test('selects every row', () => {
    expect(all(order).ids.size).toBe(5)
    expect(all([]).anchor).toBeNull()
  })
})

describe('bulkOpenList', () => {
  const page = (url: string): { url: string } => ({ url })

  test('keeps web pages in the order given', () => {
    const list = [page('https://a.test/'), page('http://b.test/'), page('https://c.test/')]
    expect(bulkOpenList(list)).toEqual(list)
  })

  test('drops everything that is not a web address', () => {
    const list = [
      page('panes://settings'),
      page('file:///C:/secret.txt'),
      page('javascript:alert(1)'),
      page('data:text/html,hi'),
      page(''),
      page('https://ok.test/')
    ]
    expect(bulkOpenList(list)).toEqual([page('https://ok.test/')])
  })

  test('opens each address once, the first time it appears', () => {
    const a = { url: 'https://a.test/', title: 'first' }
    const dup = { url: 'https://a.test/', title: 'second' }
    expect(bulkOpenList([a, dup, page('https://b.test/')])).toEqual([a, page('https://b.test/')])
  })

  test('stops at the limit', () => {
    const many = Array.from({ length: BULK_OPEN_MAX + 20 }, (_, i) => page(`https://h${i}.test/`))
    expect(bulkOpenList(many)).toHaveLength(BULK_OPEN_MAX)
    expect(bulkOpenList(many, 3).map((p) => p.url)).toEqual([
      'https://h0.test/',
      'https://h1.test/',
      'https://h2.test/'
    ])
  })

  test('matches the scheme whatever its case, and survives junk entries', () => {
    expect(bulkOpenList([page('HTTPS://A.TEST/')])).toHaveLength(1)
    const junk = [null, undefined, {}, { url: 5 }] as unknown as Array<{ url: string }>
    expect(bulkOpenList(junk)).toEqual([])
  })
})
