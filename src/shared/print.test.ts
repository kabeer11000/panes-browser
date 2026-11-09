import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_PRINT_OPTIONS as D,
  countPdfPages,
  normalizeOptions,
  parsePageRanges,
  pdfFileName,
  remembered,
  resolvePages,
  toPdfOptions,
  toPrinterOptions
} from './print'

describe('parsePageRanges', () => {
  test('empty is every page', () => {
    expect(parsePageRanges('  ')).toEqual({ ok: true, ranges: [] })
  })
  test('sorts and merges', () => {
    expect(parsePageRanges('5, 1-3, 4, 2')).toEqual({ ok: true, ranges: [{ from: 1, to: 5 }] })
    expect(parsePageRanges('8-9,1')).toEqual({
      ok: true,
      ranges: [
        { from: 1, to: 1 },
        { from: 8, to: 9 }
      ]
    })
  })
  test('open end and total', () => {
    expect(parsePageRanges('3-', 6)).toEqual({ ok: true, ranges: [{ from: 3, to: 6 }] })
    expect(parsePageRanges('2-99', 4)).toEqual({ ok: true, ranges: [{ from: 2, to: 4 }] })
    expect(parsePageRanges('7', 4).ok).toBe(false)
  })
  test('errors', () => {
    for (const bad of ['0', '3-1', 'a', '1,,2', '1-2-3', '-4', '1;2']) {
      expect(parsePageRanges(bad).ok).toBe(false)
    }
  })
})

describe('normalizeOptions', () => {
  test('garbage falls back to the defaults', () => {
    expect(normalizeOptions(null)).toEqual(D)
    expect(normalizeOptions({ copies: 'x', paper: 'B7', scale: NaN, landscape: 1 })).toEqual(D)
  })
  test('values are clamped', () => {
    const o = normalizeOptions({ copies: 500, scale: 5, customMarginMm: 999, paper: 'Letter' })
    expect([o.copies, o.scale, o.customMarginMm, o.paper]).toEqual([99, 10, 50, 'Letter'])
  })
  test('base shows through for missing fields', () => {
    expect(normalizeOptions({}, { ...D, landscape: true }).landscape).toBe(true)
  })
  test('remembered leaves out the job fields', () => {
    const r = remembered({ ...D, copies: 3, pages: '1', allPages: false, landscape: true })
    expect(r).toEqual({ ...remembered(D), landscape: true })
    expect('copies' in r || 'pages' in r || 'allPages' in r).toBe(false)
  })
})

describe('electron options', () => {
  test('pdf', () => {
    const o = { ...D, margins: 'minimum' as const, scale: 50, landscape: true }
    const p = toPdfOptions(o, [{ from: 1, to: 2 }])
    expect(p.scale).toBe(0.5)
    expect(p.pageRanges).toBe('1-2')
    expect(p.margins.top).toBeCloseTo(4 / 25.4)
    expect(p.landscape).toBe(true)
  })
  test('printer ranges are 0-based and capped', () => {
    const j = toPrinterOptions({ ...D, destination: 'HP' }, [{ from: 2, to: Infinity }], 5)
    expect(j.pageRanges).toEqual([{ from: 1, to: 4 }])
    expect(j.deviceName).toBe('HP')
    expect(j.margins.top).toBe(28) // 10 mm in points
    expect(toPrinterOptions(D, [], 5).pageRanges).toBeUndefined()
  })
  test('resolvePages', () => {
    expect(resolvePages(D, 3)).toEqual({ ok: true, ranges: [] })
    expect(resolvePages({ ...D, allPages: false, pages: '2' }, 3)).toEqual({
      ok: true,
      ranges: [{ from: 2, to: 2 }]
    })
  })
})

describe('pdf', () => {
  test('counts pages, not the page tree', () => {
    const s =
      '1 0 obj<</Type /Pages /Count 2>>endobj 2 0 obj<</Type /Page>>endobj 3 0 obj<</Type/Page>>'
    expect(countPdfPages(new TextEncoder().encode(s))).toBe(2)
  })
  test('file name', () => {
    expect(pdfFileName('Quarterly report - Acme', 'https://acme.com/r')).toBe(
      'Quarterly report.pdf'
    )
    expect(pdfFileName('', 'https://www.acme.com/r')).toBe('acme.com.pdf')
    expect(pdfFileName('a/b:c', 'x')).toBe('a bc.pdf')
    expect(pdfFileName('', 'about:blank')).toBe('page.pdf')
  })
})
