import { describe, expect, test } from 'bun:test'
import { boardStep, browseWith, isBrowseWith, type BrowseSeen } from './browse'

describe('browseWith', () => {
  test('a space without a choice follows the global setting', () => {
    expect(browseWith('tabs')).toBe('tabs')
    expect(browseWith('canvas', { browseWith: null })).toBe('canvas')
    expect(browseWith('canvas', {})).toBe('canvas')
  })
  test("a space's own choice wins", () => {
    expect(browseWith('tabs', { browseWith: 'canvas' })).toBe('canvas')
    expect(browseWith('canvas', { browseWith: 'tabs' })).toBe('tabs')
  })
  test('isBrowseWith takes only the two modes', () => {
    expect(isBrowseWith('tabs')).toBe(true)
    expect(isBrowseWith('canvas')).toBe(true)
    expect(isBrowseWith('grid')).toBe(false)
    expect(isBrowseWith(null)).toBe(false)
  })
})

describe('boardStep', () => {
  const c = (space: number): BrowseSeen => ({ space, browse: 'canvas' })
  const t = (space: number): BrowseSeen => ({ space, browse: 'tabs' })
  test('starting in a canvas space opens the board', () => {
    expect(boardStep(null, c(1))).toBe('open')
  })
  test('starting in a tabs space does nothing', () => {
    expect(boardStep(null, t(1))).toBe(null)
  })
  test('entering a canvas space opens its board, from either kind', () => {
    expect(boardStep(t(1), c(2))).toBe('open')
    expect(boardStep(c(1), c(2))).toBe('open')
  })
  test('the same canvas space again does nothing (a popped-out card stays out)', () => {
    expect(boardStep(c(1), c(1))).toBe(null)
  })
  test('switching the space to canvas opens, to tabs closes', () => {
    expect(boardStep(t(1), c(1))).toBe('open')
    expect(boardStep(c(1), t(1))).toBe('close')
  })
  test('leaving a canvas space for a tabs space closes the board', () => {
    expect(boardStep(c(1), t(2))).toBe('close')
  })
  test('between tabs spaces a board opened by hand is left alone', () => {
    expect(boardStep(t(1), t(2))).toBe(null)
    expect(boardStep(t(1), t(1))).toBe(null)
  })
})
