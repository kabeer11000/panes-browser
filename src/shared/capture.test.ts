import { describe, expect, test } from 'bun:test'
import { CAPTURE_PREFIX, isCapturing, NO_CAPTURE, parseCapture } from './capture'

describe('parseCapture', () => {
  test('reads the report a page prints', () => {
    expect(
      parseCapture(CAPTURE_PREFIX + JSON.stringify({ camera: true, mic: false, screen: true }))
    ).toEqual({ camera: true, mic: false, screen: true })
  })
  test('ignores other messages and garbage', () => {
    expect(parseCapture('hello')).toBeNull()
    expect(parseCapture(CAPTURE_PREFIX + '{nope')).toBeNull()
  })
  test('only literal true counts', () => {
    expect(parseCapture(CAPTURE_PREFIX + '{"camera":"yes","mic":1}')).toEqual(NO_CAPTURE)
  })
})

describe('isCapturing', () => {
  test('any one kind', () => {
    expect(isCapturing(NO_CAPTURE)).toBe(false)
    expect(isCapturing({ ...NO_CAPTURE, mic: true })).toBe(true)
  })
})
