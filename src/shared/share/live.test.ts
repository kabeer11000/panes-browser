import { describe, expect, test } from 'bun:test'
import {
  inOrder,
  downscaleFor,
  driverKeyAllowed,
  electronKey,
  focusInset,
  parseRemoteInput,
  pointerOver,
  sizeFor,
  videoBox,
  videoRect
} from './live'

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
    expect(parseRemoteInput({ t: 'key', key: 'a', up: true, mods: ['shift', 'hyper', 7] })).toEqual(
      {
        t: 'key',
        key: 'a',
        up: true,
        mods: ['shift']
      }
    )
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

describe('a live picture no bigger than it is shown', () => {
  test('full size when the box is as big, or nearly, or unknown', () => {
    expect(downscaleFor({ w: 1920, h: 1080 }, { w: 1920, h: 1080 })).toBe(1)
    expect(downscaleFor({ w: 1920, h: 1080 }, { w: 1800, h: 1013 })).toBe(1)
    expect(downscaleFor({ w: 1920, h: 1080 }, { w: 0, h: 0 })).toBe(1)
    expect(downscaleFor({ w: 0, h: 0 }, { w: 640, h: 360 })).toBe(1)
  })
  test('shrunk to fit a smaller box, in quarter steps, by the side that limits', () => {
    expect(downscaleFor({ w: 1920, h: 1080 }, { w: 960, h: 540 })).toBe(2)
    // a tall panel: the width limits
    expect(downscaleFor({ w: 1920, h: 1080 }, { w: 640, h: 2000 })).toBe(3)
    expect(downscaleFor({ w: 1920, h: 1080 }, { w: 1100, h: 700 })).toBe(1.75)
    expect(downscaleFor({ w: 1920, h: 1080 }, { w: 20, h: 20 })).toBe(8)
  })
})

describe("the host's pointer over the live page", () => {
  const content = { x: 100, y: 50 }
  const view = { x: 240, y: 40, width: 1000, height: 600 }
  const size = { w: 1300, h: 700 }
  test('as fractions of the page when over it', () => {
    expect(pointerOver({ x: 100 + 240 + 500, y: 50 + 40 + 150 }, content, view, size)).toEqual({
      x: 0.5,
      y: 0.25
    })
  })
  test('null off the page: over the sidebar, or past its edge', () => {
    expect(pointerOver({ x: 120, y: 200 }, content, view, size)).toBeNull()
    expect(pointerOver({ x: 100 + 240 + 1001, y: 200 }, content, view, size)).toBeNull()
  })
  test('null while the page is parked in the corner, painting for the watchers', () => {
    const parked = { x: 1297, y: 697, width: 1000, height: 600 }
    expect(pointerOver({ x: 100 + 1298, y: 50 + 698 }, content, parked, size)).toBeNull()
  })
})

describe('sizeFor (one line shared by the viewer and the cards)', () => {
  test("the viewer's size wins, and is never marked a card's", () => {
    expect(
      sizeFor([
        { w: 400, h: 300, card: true },
        { w: 1600, h: 900 },
        { w: 2000, h: 2000, card: true }
      ])
    ).toEqual({ w: 1600, h: 900 })
  })
  test("cards only: the largest card's, marked a card's", () => {
    expect(
      sizeFor([
        { w: 300, h: 200, card: true },
        { w: 600, h: 400, card: true }
      ])
    ).toEqual({ w: 600, h: 400, card: true })
  })
  test('nothing sized (or zero sizes): nothing is sent', () => {
    expect(sizeFor([])).toBeNull()
    expect(sizeFor([null, { w: 0, h: 300, card: true }])).toBeNull()
  })
})

describe('what the driver may press', () => {
  test('typing, editing and moving about in the page pass', () => {
    for (const k of ['a', 'Z', ' ', 'Enter', 'Backspace', 'Tab', 'ArrowDown', 'Escape'])
      expect(driverKeyAllowed(k, [])).toBe(true)
    expect(driverKeyAllowed('A', ['shift'])).toBe(true)
    for (const k of ['a', 'c', 'x', 'z', 'y', 'ArrowLeft', 'Backspace'])
      expect(driverKeyAllowed(k, ['control'])).toBe(true)
    expect(driverKeyAllowed('Z', ['control', 'shift'])).toBe(true)
  })

  test("the host's browser, clipboard and computer stay the host's", () => {
    // new tab, close tab, address bar, find, print, save, reload, devtools, history
    for (const k of ['t', 'w', 'l', 'f', 'p', 's', 'r', 'h', 'n', 'Tab', 'q'])
      expect(driverKeyAllowed(k, ['control'])).toBe(false)
    expect(driverKeyAllowed('v', ['control'])).toBe(false) // would paste the host's clipboard
    expect(driverKeyAllowed('I', ['control', 'shift'])).toBe(false)
    expect(driverKeyAllowed('ArrowLeft', ['alt'])).toBe(false)
    expect(driverKeyAllowed('F4', ['alt'])).toBe(false)
    expect(driverKeyAllowed('r', ['meta'])).toBe(false)
    for (const k of ['F5', 'F11', 'F12', 'ContextMenu']) expect(driverKeyAllowed(k, [])).toBe(false)
  })
})

describe('focus on video', () => {
  test('videoRect takes a video inside the page, big enough, and nothing else', () => {
    expect(videoRect([0.1, 0.2, 0.6, 0.5])).toEqual([0.1, 0.2, 0.6, 0.5])
    expect(videoRect([0, 0, 1, 1])).toEqual([0, 0, 1, 1])
    for (const bad of [
      null,
      'inset(0)',
      [0, 0, 1],
      [0, 0, 0.01, 0.5],
      [-0.1, 0, 0.5, 0.5],
      [0.6, 0, 0.5, 0.5],
      [0, 0, 0.5, Number.NaN],
      [0, 0, '1', 1]
    ])
      expect(videoRect(bad)).toBeNull()
  })

  test('focusInset crops to exactly that part', () => {
    expect(focusInset([0.1, 0.2, 0.6, 0.5])).toBe('inset(20.00% 30.00% 30.00% 10.00%)')
    expect(focusInset([0, 0, 1, 1])).toBe('inset(0.00% 0.00% 0.00% 0.00%)')
  })
})

describe('inOrder', () => {
  test('a slow signal finishes before the next one starts, and a failure does not stop the rest', async () => {
    const seen: string[] = []
    const handle = inOrder(async (k: string) => {
      if (k === 'offer') await new Promise((r) => setTimeout(r, 20))
      if (k === 'bad') throw new Error('x')
      seen.push(k)
    })
    handle('offer')
    handle('ice')
    handle('bad')
    handle('ice2')
    await new Promise((r) => setTimeout(r, 60))
    expect(seen).toEqual(['offer', 'ice', 'ice2'])
  })
})
