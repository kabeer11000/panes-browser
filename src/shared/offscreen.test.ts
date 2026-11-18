import { describe, expect, test } from 'bun:test'
import {
  cssCursor,
  frameAt,
  keyText,
  parseOsrKey,
  toCdpKey,
  toElectronKeys,
  type OsrKey,
  heldButtons,
  MULTI_CLICK_MS,
  nextClickCount,
  ACTIVE_MS,
  osrFrameRate,
  parseOsrDrop,
  parseOsrInput,
  toCdpMouse,
  toPagePoint,
  wheelDelta
} from './offscreen'

describe('parseOsrInput', () => {
  test('mouse events keep only what is allowed', () => {
    expect(
      parseOsrInput({ type: 'mouseDown', x: 10, y: 20, button: 'left', clickCount: 2, extra: 1 })
    ).toEqual({
      type: 'mouseDown',
      x: 10,
      y: 20,
      button: 'left',
      clickCount: 2,
      modifiers: undefined
    })
    expect(parseOsrInput({ type: 'mouseMove', x: 1, y: 2, button: 'nose' })).toEqual({
      type: 'mouseMove',
      x: 1,
      y: 2,
      modifiers: undefined
    })
  })
  test('wheel', () => {
    expect(parseOsrInput({ type: 'mouseWheel', x: 1, y: 2, deltaY: -120 })).toEqual({
      type: 'mouseWheel',
      x: 1,
      y: 2,
      deltaX: 0,
      deltaY: -120,
      modifiers: undefined
    })
  })
  test('keys, with known modifiers only', () => {
    expect(
      parseOsrInput({ type: 'keyDown', keyCode: 'Enter', modifiers: ['control', 'evil'] })
    ).toEqual({
      type: 'keyDown',
      keyCode: 'Enter',
      modifiers: ['control']
    })
    expect(parseOsrInput({ type: 'char', keyCode: 'é' })?.type).toBe('char')
  })
  test('rejects junk', () => {
    expect(parseOsrInput(null)).toBeNull()
    expect(parseOsrInput({ type: 'quit' })).toBeNull()
    expect(parseOsrInput({ type: 'mouseDown', x: NaN, y: 1 })).toBeNull()
    expect(parseOsrInput({ type: 'mouseDown', x: 1e9, y: 1 })).toBeNull()
    expect(parseOsrInput({ type: 'keyDown', keyCode: '' })).toBeNull()
    expect(parseOsrInput({ type: 'keyDown', keyCode: 'x'.repeat(100) })).toBeNull()
  })
})

describe('toPagePoint', () => {
  test('through whatever size the canvas is drawn at', () => {
    const page = { width: 1000, height: 800 }
    // drawn at half size, 100 px in
    const box = { left: 100, top: 50, width: 500, height: 400 }
    expect(toPagePoint(100, 50, box, page)).toEqual({ x: 0, y: 0 })
    expect(toPagePoint(350, 250, box, page)).toEqual({ x: 500, y: 400 })
    expect(toPagePoint(600, 450, box, page)).toEqual({ x: 1000, y: 800 })
  })
  test('an empty box maps to the corner', () => {
    expect(
      toPagePoint(5, 5, { left: 0, top: 0, width: 0, height: 0 }, { width: 10, height: 10 })
    ).toEqual({
      x: 0,
      y: 0
    })
  })
})

describe('wheelDelta', () => {
  test('pixels, lines and pages, flipped to Chromium sign', () => {
    expect(wheelDelta(100, 0)).toBe(-100)
    expect(wheelDelta(3, 1)).toBe(-120)
    expect(wheelDelta(-1, 2)).toBe(800)
  })
})

describe('osrFrameRate', () => {
  test('full rate while used or playing, 30 at rest', () => {
    expect(osrFrameRate({ displayHz: 120, sinceInputMs: 0, media: false })).toBe(120)
    expect(osrFrameRate({ displayHz: 120, sinceInputMs: ACTIVE_MS, media: false })).toBe(30)
    expect(osrFrameRate({ displayHz: 120, sinceInputMs: 1e9, media: true })).toBe(120)
  })
  test('never above the display, and a sane default', () => {
    expect(osrFrameRate({ displayHz: 24, sinceInputMs: 1e9, media: false })).toBe(24)
    expect(osrFrameRate({ displayHz: 0, sinceInputMs: 0, media: false })).toBe(60)
  })
})

describe('parseOsrDrop', () => {
  test('files and text', () => {
    expect(parseOsrDrop({ x: 1, y: 2, files: ['C:/a.txt', 5, ''], text: 'hi' })).toEqual({
      x: 1,
      y: 2,
      files: ['C:/a.txt'],
      text: 'hi',
      uri: null
    })
  })
  test('nothing to drop, or a bad point', () => {
    expect(parseOsrDrop({ x: 1, y: 2, files: [] })).toBeNull()
    expect(parseOsrDrop({ x: 'a', y: 2, files: ['x'] })).toBeNull()
    expect(parseOsrDrop(null)).toBeNull()
  })
})

describe('heldButtons', () => {
  test('none held, none sent: a plain move is not a drag', () => expect(heldButtons(0)).toEqual([]))
  test('each held button', () => {
    expect(heldButtons(1)).toEqual(['leftButtonDown'])
    expect(heldButtons(2)).toEqual(['rightButtonDown'])
    expect(heldButtons(4)).toEqual(['middleButtonDown'])
    expect(heldButtons(5)).toEqual(['leftButtonDown', 'middleButtonDown'])
  })
  test('they pass the input check', () => {
    const ev = parseOsrInput({ type: 'mouseMove', x: 1, y: 1, modifiers: heldButtons(1) })
    expect(ev?.modifiers).toEqual(['leftButtonDown'])
  })
})

describe('nextClickCount', () => {
  const at = (
    t: number,
    x = 10,
    y = 10,
    button = 0
  ): { at: number; x: number; y: number; button: number } => ({ at: t, x, y, button })
  test('a first press is one click', () => expect(nextClickCount(null, at(0))).toBe(1))
  test('a quick second press in place is a double click, then a triple, then one again', () => {
    expect(nextClickCount({ ...at(0), count: 1 }, at(200))).toBe(2)
    expect(nextClickCount({ ...at(0), count: 2 }, at(200))).toBe(3)
    expect(nextClickCount({ ...at(0), count: 3 }, at(200))).toBe(1)
  })
  test('too late, too far, or another button: one click', () => {
    expect(nextClickCount({ ...at(0), count: 1 }, at(MULTI_CLICK_MS + 1))).toBe(1)
    expect(nextClickCount({ ...at(0), count: 1 }, at(100, 30, 10))).toBe(1)
    expect(nextClickCount({ ...at(0), count: 1 }, at(100, 10, 10, 2))).toBe(1)
  })
})

describe('frameAt', () => {
  const a = { session: 'a', rect: { x: 0, y: 0, width: 100, height: 100 } }
  const b = { session: 'b', rect: { x: 50, y: 50, width: 100, height: 100 } }
  test('the page itself outside every frame', () => expect(frameAt([a, b], 200, 200)).toBeNull())
  test('the frame under the point; the later one where they overlap', () => {
    expect(frameAt([a, b], 10, 10)).toBe(a)
    expect(frameAt([a, b], 60, 60)).toBe(b)
  })
  test('a frame not yet placed is never hit', () =>
    expect(frameAt([{ session: 'c', rect: null }], 0, 0)).toBeNull())
})

describe('toCdpMouse', () => {
  test('a press, a release and a move with the button held', () => {
    expect(
      toCdpMouse({ type: 'mouseDown', x: 1, y: 2, button: 'left', clickCount: 2 }, 5, 6)
    ).toEqual({
      type: 'mousePressed',
      x: 5,
      y: 6,
      modifiers: 0,
      buttons: 0,
      button: 'left',
      clickCount: 2
    })
    expect(toCdpMouse({ type: 'mouseUp', x: 1, y: 2, button: 'right' }, 5, 6)?.type).toBe(
      'mouseReleased'
    )
    const move = toCdpMouse(
      { type: 'mouseMove', x: 1, y: 2, modifiers: ['shift', 'leftButtonDown'] },
      5,
      6
    )
    expect(move).toMatchObject({ type: 'mouseMoved', button: 'left', buttons: 1, modifiers: 8 })
  })
  test('a plain move holds no button', () =>
    expect(toCdpMouse({ type: 'mouseMove', x: 1, y: 2 }, 0, 0)).toMatchObject({
      button: 'none',
      buttons: 0
    }))
  test('the wheel turns the other way round', () =>
    expect(
      toCdpMouse({ type: 'mouseWheel', x: 1, y: 2, deltaX: 0, deltaY: 120 }, 0, 0)
    ).toMatchObject({
      deltaX: -0,
      deltaY: -120
    }))
  test('enter and leave have no event of their own', () =>
    expect(toCdpMouse({ type: 'mouseLeave', x: 1, y: 2 }, 0, 0)).toBeNull())
})

describe('keys', () => {
  const key = (k: Partial<OsrKey>): OsrKey => ({
    type: 'down',
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    location: 0,
    repeat: false,
    modifiers: [],
    ...k
  })
  test('parseOsrKey keeps what is sound, refuses the rest', () => {
    expect(
      parseOsrKey({ type: 'down', key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 })
    ).toMatchObject({ key: 'ArrowLeft', keyCode: 37, modifiers: [] })
    expect(parseOsrKey({ type: 'press', key: 'a', keyCode: 65 })).toBeNull()
    expect(parseOsrKey({ type: 'down', key: '', keyCode: 65 })).toBeNull()
    expect(parseOsrKey({ type: 'down', key: 'a', keyCode: 999 })).toBeNull()
  })
  test('text: a character, a return for Enter, nothing for chords and named keys', () => {
    expect(keyText(key({}))).toBe('a')
    expect(keyText(key({ key: 'Enter' }))).toBe('\r')
    expect(keyText(key({ key: 'ArrowLeft' }))).toBe('')
    expect(keyText(key({ modifiers: ['control'] }))).toBe('')
    expect(keyText(key({ key: 'A', modifiers: ['shift'] }))).toBe('A')
  })
  test('toCdpKey: text keys are keyDown with their text, the others rawKeyDown', () => {
    expect(toCdpKey(key({}))).toMatchObject({
      type: 'keyDown',
      text: 'a',
      windowsVirtualKeyCode: 65
    })
    expect(toCdpKey(key({ key: 'Enter', code: 'Enter', keyCode: 13 }))).toMatchObject({
      type: 'keyDown',
      text: '\r'
    })
    const left = toCdpKey(key({ key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }))
    expect(left).toMatchObject({ type: 'rawKeyDown', key: 'ArrowLeft', windowsVirtualKeyCode: 37 })
    expect(left.text).toBeUndefined()
    expect(toCdpKey(key({ type: 'up' }))).toMatchObject({ type: 'keyUp' })
    expect(toCdpKey(key({ modifiers: ['control', 'shift'] }))).toMatchObject({
      type: 'rawKeyDown',
      modifiers: 10
    })
  })
  test('toElectronKeys: accelerator names, and the character as its own event', () => {
    expect(toElectronKeys(key({ key: 'ArrowLeft' }))).toEqual([
      { type: 'keyDown', keyCode: 'Left', modifiers: [] }
    ])
    expect(toElectronKeys(key({ key: 'Enter' }))).toEqual([
      { type: 'keyDown', keyCode: 'Enter', modifiers: [] },
      { type: 'char', keyCode: '\r', modifiers: [] }
    ])
    expect(toElectronKeys(key({ type: 'up', key: ' ' }))).toEqual([
      { type: 'keyUp', keyCode: 'Space', modifiers: [] }
    ])
  })
})

describe('cssCursor', () => {
  test('the names Electron gives are CSS names', () => {
    expect(cssCursor('pointer')).toBe('pointer')
    expect(cssCursor('text')).toBe('text')
    expect(cssCursor('nwse-resize')).toBe('nwse-resize')
  })
  test('its other names', () => {
    expect(cssCursor('hand')).toBe('pointer')
    expect(cssCursor('nodrop')).toBe('no-drop')
    expect(cssCursor('e-panning')).toBe('all-scroll')
  })
  test('anything else is the arrow', () => expect(cssCursor('custom')).toBe('default'))
})
