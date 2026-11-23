import { describe, expect, test } from 'bun:test'
import { hasMarks, markFor, parseInline, toggleMark } from './noteMarks'

describe('bold, italic and struck words in a note', () => {
  test('markers become styles', () => {
    expect(parseInline('a **bold** and _soft_ ~~gone~~ word')).toEqual([
      { t: 'a ' },
      { t: 'bold', b: true },
      { t: ' and ' },
      { t: 'soft', i: true },
      { t: ' ' },
      { t: 'gone', s: true },
      { t: ' word' }
    ])
  })
  test('nested: bold and italic at once', () => {
    expect(parseInline('**very _much_ so**')).toEqual([
      { t: 'very ', b: true },
      { t: 'much', b: true, i: true },
      { t: ' so', b: true }
    ])
  })
  test('what is not a pair is shown as typed', () => {
    expect(parseInline('2 ** 3 and **not closed')).toEqual([{ t: '2 ** 3 and **not closed' }])
    expect(parseInline('snake_case_name')).toEqual([{ t: 'snake_case_name' }])
    expect(parseInline('** spaced **')).toEqual([{ t: '** spaced **' }])
    expect(parseInline('**over\nlines**')).toEqual([{ t: '**over\nlines**' }])
    expect(hasMarks('plain text, 5 * 3')).toBe(false)
    expect(hasMarks('a **b**')).toBe(true)
  })
})

describe('Ctrl+B and Ctrl+I while writing', () => {
  test('wraps the selection, keeping it selected', () => {
    expect(toggleMark('make this bold', 5, 9, '**')).toEqual({
      value: 'make **this** bold',
      start: 7,
      end: 11
    })
  })
  test('a double-clicked word with its space: the space stays outside', () => {
    expect(toggleMark('one two three', 4, 8, '_')).toEqual({
      value: 'one _two_ three',
      start: 5,
      end: 8
    })
  })
  test('pressed again, unwraps (markers just outside, or selected with it)', () => {
    expect(toggleMark('make **this** bold', 7, 11, '**')).toEqual({
      value: 'make this bold',
      start: 5,
      end: 9
    })
    expect(toggleMark('make **this** bold', 5, 13, '**')).toEqual({
      value: 'make this bold',
      start: 5,
      end: 9
    })
  })
  test('nothing selected: a pair with the caret between', () => {
    expect(toggleMark('ab', 1, 1, '~~')).toEqual({ value: 'a~~~~b', start: 3, end: 3 })
  })
})

describe('markFor (the formatting keys in notes, labels and shapes)', () => {
  const k = (
    key: string,
    mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}
  ) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods
  })
  test('Ctrl+B, Ctrl+I and Ctrl+Shift+X (Cmd on a Mac)', () => {
    expect(markFor(k('b', { ctrlKey: true }))).toBe('**')
    expect(markFor(k('I', { metaKey: true }))).toBe('_')
    expect(markFor(k('X', { ctrlKey: true, shiftKey: true }))).toBe('~~')
  })
  test('cut, plain letters, Alt and Shift with B or I are left alone', () => {
    expect(markFor(k('x', { ctrlKey: true }))).toBeUndefined()
    expect(markFor(k('b'))).toBeUndefined()
    expect(markFor(k('b', { ctrlKey: true, altKey: true }))).toBeUndefined()
    expect(markFor(k('b', { ctrlKey: true, shiftKey: true }))).toBeUndefined()
    expect(markFor(k('a', { ctrlKey: true }))).toBeUndefined()
  })
})
