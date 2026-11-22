import { describe, expect, test } from 'bun:test'
import { electronKey, parseRemoteInput, videoBox } from './live'

describe('remote input from the person driving', () => {
  test('pointer events pass, clamped to the page', () => {
    expect(parseRemoteInput({ t: 'down', x: 0.5, y: 1.4, b: 'right', n: 2 })).toEqual({
      t: 'down',
      x: 0.5,
      y: 1,
      b: 'right',
      n: 2
    })
    expect(parseRemoteInput({ t: 'move', x: -3, y: 0.2 })).toEqual({ t: 'move', x: 0, y: 0.2 })
  })

  test('anything malformed is dropped, never guessed at', () => {
    expect(parseRemoteInput(null)).toBeNull()
    expect(parseRemoteInput({ t: 'down', x: 'a', y: 0 })).toBeNull()
    expect(parseRemoteInput({ t: 'eval', code: 'x' })).toBeNull()
    expect(parseRemoteInput({ t: 'char', text: 'way too long text' })).toBeNull()
    expect(parseRemoteInput({ t: 'key', key: '' })).toBeNull()
  })

  test('only known buttons and modifiers come through', () => {
    expect(parseRemoteInput({ t: 'up', x: 0, y: 0, b: 'back' })).toEqual({ t: 'up', x: 0, y: 0 })
    expect(parseRemoteInput({ t: 'key', key: 'a', up: true, mods: ['shift', 'hyper', 7] })).toEqual({
      t: 'key',
      key: 'a',
      up: true,
      mods: ['shift']
    })
  })

  test('wheel deltas are bounded', () => {
    expect(parseRemoteInput({ t: 'wheel', x: 0.1, y: 0.1, dx: 0, dy: 99999 })).toEqual({
      t: 'wheel',
      x: 0.1,
      y: 0.1,
      dx: 0,
      dy: 2000
    })
  })

  test('browser key names become Electron key codes', () => {
    expect(electronKey('ArrowLeft')).toBe('Left')
    expect(electronKey(' ')).toBe('Space')
    expect(electronKey('a')).toBe('a')
  })
})

describe('videoBox', () => {
  test('a wide picture in a tall element is letterboxed top and bottom', () => {
    const b = videoBox({ width: 1000, height: 1000 }, { width: 1920, height: 1080 })
    expect(b.x).toBeCloseTo(0)
    expect(b.y).toBeCloseTo(218.75)
    expect(b.width).toBeCloseTo(1000)
    expect(b.height).toBeCloseTo(562.5)
  })
  test('no picture yet: the whole element', () => {
    expect(videoBox({ width: 400, height: 300 }, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300
    })
  })
})
