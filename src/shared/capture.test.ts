import { describe, expect, test } from 'bun:test'
import {
  CAPTURE_HOLD_MS,
  CAPTURE_PREFIX,
  captureKindsOf,
  holdCapture,
  isCapturing,
  mergeCapture,
  NO_CAPTURE,
  NO_HOLD,
  mergeSources,
  nextSharePass,
  parseCapture,
  SHARE_REFRESH_MS,
  shareAudio,
  shareTab,
  stopCaptureScript
} from './capture'
import type { ScreenSource } from './types'

describe('holdCapture', () => {
  const mic = { ...NO_CAPTURE, mic: true }

  test('turns on at once', () => {
    const { hold, settleIn } = holdCapture(NO_HOLD, mic, 0)
    expect(hold.shown).toEqual(mic)
    expect(settleIn).toBeNull()
  })

  test('a short gap does not turn it off, and says when to look again', () => {
    const on = holdCapture(NO_HOLD, mic, 0).hold
    const gap = holdCapture(on, NO_CAPTURE, 100)
    expect(gap.hold.shown.mic).toBe(true)
    expect(gap.settleIn).toBe(CAPTURE_HOLD_MS)
    // the page took the microphone again: the gap never showed
    const back = holdCapture(gap.hold, mic, 400)
    expect(back.hold.shown).toBe(on.shown)
    expect(back.hold.offSince).toEqual({})
  })

  test('the gap is measured from when it stopped, not from the last look', () => {
    const on = holdCapture(NO_HOLD, mic, 0).hold
    const a = holdCapture(on, NO_CAPTURE, 100).hold
    const b = holdCapture(a, NO_CAPTURE, 1000)
    expect(b.hold.shown.mic).toBe(true)
    expect(b.settleIn).toBe(CAPTURE_HOLD_MS - 900)
    const c = holdCapture(b.hold, NO_CAPTURE, 100 + CAPTURE_HOLD_MS)
    expect(c.hold.shown).toEqual(NO_CAPTURE)
    expect(c.settleIn).toBeNull()
  })

  test('keeps the same object while nothing shown changes', () => {
    const on = holdCapture(NO_HOLD, mic, 0).hold
    expect(holdCapture(on, mic, 50).hold.shown).toBe(on.shown)
  })

  test('each kind is held on its own', () => {
    const both = holdCapture(NO_HOLD, { ...NO_CAPTURE, mic: true, camera: true }, 0).hold
    const camOff = holdCapture(both, mic, 10)
    expect(camOff.hold.shown).toEqual({ camera: true, mic: true, screen: false })
    expect(camOff.hold.offSince).toEqual({ camera: 10 })
  })
})

describe('screen share picker', () => {
  const src = (id: string, extra: Partial<ScreenSource> = {}): ScreenSource => ({
    id,
    name: id,
    kind: id.startsWith('screen:') ? 'screen' : 'window',
    thumb: '',
    icon: '',
    ...extra
  })

  test('passes go names, screens, then start over after a pause', () => {
    expect(nextSharePass(null)).toEqual({ pass: 'names', delay: 0 })
    expect(nextSharePass('names')).toEqual({ pass: 'screens', delay: 0 })
    expect(nextSharePass('screens')).toEqual({ pass: 'names', delay: SHARE_REFRESH_MS })
  })

  test('the names pass builds the list', () => {
    const names = [src('screen:0:0'), src('window:1:0')]
    expect(mergeSources([], names, ['screen', 'window'])).toEqual(names)
  })

  test('a pass fills in pictures of its kind and leaves the other kind alone', () => {
    const list = [src('screen:0:0'), src('window:1:0', { thumb: 'old' })]
    const out = mergeSources(list, [src('screen:0:0', { thumb: 'pic' })], ['screen'])
    expect(out).toEqual([src('screen:0:0', { thumb: 'pic' }), src('window:1:0', { thumb: 'old' })])
  })

  test('a picture the pass did not bring keeps the last one', () => {
    const list = [src('window:1:0', { thumb: 'old', icon: 'i' })]
    expect(mergeSources(list, [src('window:1:0')], ['window'])[0]).toMatchObject({
      thumb: 'old',
      icon: 'i'
    })
  })

  test('closed windows go, new ones join at the end, order is kept', () => {
    const list = [src('window:1:0'), src('window:2:0'), src('window:3:0')]
    const pass = [src('window:4:0'), src('window:3:0'), src('window:1:0')]
    expect(mergeSources(list, pass, ['window']).map((s) => s.id)).toEqual([
      'window:1:0',
      'window:3:0',
      'window:4:0'
    ])
  })

  test('the tab follows the list until one is chosen', () => {
    expect(shareTab(null, 0, 0)).toBe('screen')
    expect(shareTab(null, 0, 3)).toBe('window')
    expect(shareTab(null, 1, 3)).toBe('screen')
    expect(shareTab('window', 1, 0)).toBe('window')
  })

  test('system sound only for a whole screen, asked for and wanted', () => {
    expect(shareAudio('screen:0:0', true, true)).toBe(true)
    expect(shareAudio('screen:0:0', true, false)).toBe(false)
    expect(shareAudio('screen:0:0', false, true)).toBe(false)
    expect(shareAudio('window:1:0', true, true)).toBe(false)
  })
})

describe('mergeCapture and captureKindsOf', () => {
  test('a kind is live when any frame has it', () => {
    expect(
      mergeCapture([
        { ...NO_CAPTURE, camera: true },
        { ...NO_CAPTURE, mic: true }
      ])
    ).toEqual({ camera: true, mic: true, screen: false })
    expect(mergeCapture([])).toEqual(NO_CAPTURE)
  })

  test('maps permission kinds to capture kinds', () => {
    expect(captureKindsOf(['camera', 'microphone', 'location'])).toEqual(['camera', 'mic'])
    expect(captureKindsOf(['screen'])).toEqual(['screen'])
    expect(stopCaptureScript(['mic'])).toContain('["mic"]')
  })
})

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
