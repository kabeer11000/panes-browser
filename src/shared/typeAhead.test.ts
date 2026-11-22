import { describe, expect, test } from 'bun:test'
import { typeAheadKey, typeAheadSince, type KeyLike } from './typeAhead'

const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods
})

describe('type-ahead', () => {
  test('keeps letters, spaces and symbols in order', () => {
    let b = ''
    for (const ch of 'gmail.com x') b = typeAheadKey(b, k(ch)) ?? b
    expect(b).toBe('gmail.com x')
  })
  test('Backspace takes the last one back', () => {
    expect(typeAheadKey('abc', k('Backspace'))).toBe('ab')
    expect(typeAheadKey('', k('Backspace'))).toBe('')
  })
  test('shortcuts and named keys are not typing', () => {
    expect(typeAheadKey('a', k('v', { ctrlKey: true }))).toBeNull()
    expect(typeAheadKey('a', k('ArrowDown'))).toBeNull()
    expect(typeAheadKey('a', k('Enter'))).toBeNull()
    expect(typeAheadKey('a', k('t', { altKey: true }))).toBeNull()
  })
  test('keys seen before the late Ctrl+T message: only those pressed after Ctrl+T count', () => {
    const at = (key: string, t: number): KeyLike & { at: number } => ({ ...k(key), at: t })
    const keys = [at('x', 90), at('g', 105), at('ArrowDown', 110), at('m', 120)]
    expect(typeAheadSince(keys, 100)).toBe('gm')
    expect(typeAheadSince(keys, 200)).toBe('')
    expect(typeAheadSince([], 100)).toBe('')
  })
})
