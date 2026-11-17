import { describe, expect, test } from 'bun:test'
import {
  ACTIVE_MS,
  osrFrameRate,
  parseOsrDrop,
  parseOsrInput,
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
