import { describe, expect, test } from 'bun:test'
import { pageCaps, restRect, sameRect, zoomPercent } from './previewBar'

describe('pageCaps', () => {
  test('a web page gets everything', () => {
    expect(pageCaps('https://example.com/a', false)).toEqual({
      web: true,
      bookmark: true,
      copy: true,
      site: true,
      source: true
    })
  })
  test('private tabs never bookmark, but keep the rest', () => {
    const c = pageCaps('http://example.com', true)
    expect(c.bookmark).toBe(false)
    expect(c.copy && c.site && c.source).toBe(true)
  })
  test('non-web pages get nothing', () => {
    for (const u of ['panes://settings', 'file:///C:/a.pdf', '', undefined, 'about:blank'])
      expect(pageCaps(u, false)).toEqual({
        web: false,
        bookmark: false,
        copy: false,
        site: false,
        source: false
      })
  })
})

describe('restRect', () => {
  test('takes the slide out and rounds', () => {
    expect(restRect({ x: 260.4, y: 52.6, width: 800.5, height: 600.2 }, { x: 240, y: 40 })).toEqual(
      { x: 20, y: 13, width: 801, height: 600 }
    )
  })
  test('no slide is the box itself', () => {
    expect(restRect({ x: 10, y: 20, width: 30, height: 40 }, { x: 0, y: 0 })).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40
    })
  })
  test('never a negative size', () => {
    expect(restRect({ x: 0, y: 0, width: -3, height: -1 }, { x: 0, y: 0 }).width).toBe(0)
  })
})

test('sameRect', () => {
  const a = { x: 1, y: 2, width: 3, height: 4 }
  expect(sameRect(a, { ...a })).toBe(true)
  expect(sameRect(a, { ...a, width: 5 })).toBe(false)
  expect(sameRect(null, a)).toBe(false)
})

test('zoomPercent', () => {
  expect(zoomPercent(0)).toBe(100)
  expect(zoomPercent(1)).toBe(120)
  expect(zoomPercent(-1)).toBe(83)
})
