import { describe, expect, test } from 'bun:test'
import {
  captureWidth,
  fitRegion,
  pickStreams,
  streamCap,
  streamFps,
  videoRegion
} from './tabStream'

describe('streamCap', () => {
  test('an i5 with 8 threads and 8 GB gets 2 streams, a bigger machine 4', () => {
    expect(streamCap({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(2)
    expect(streamCap({ hardwareConcurrency: 4 })).toBe(2)
    expect(streamCap({})).toBe(2)
    expect(streamCap({ hardwareConcurrency: 16, deviceMemory: 4 })).toBe(2)
    expect(streamCap({ hardwareConcurrency: 16, deviceMemory: 8 })).toBe(4)
    expect(streamCap({ hardwareConcurrency: 12 })).toBe(4)
    expect(streamFps(2)).toBeLessThan(streamFps(4))
  })
})

describe('pickStreams', () => {
  const tabs = [
    { id: 1, audible: false, muted: false },
    { id: 2, audible: true, muted: true },
    { id: 3, audible: true, muted: false },
    { id: 4, audible: true, muted: false },
    { id: 5, audible: false, muted: true }
  ]
  const all = new Set([1, 2, 3, 4, 5])
  test('playing tabs on screen, sounding first, silent tabs never', () => {
    expect(pickStreams({ tabs, onScreen: all, open: null, zoomedOut: false, cap: 4 })).toEqual([
      3, 4, 2, 5
    ])
  })
  test('off-screen cards and the tab open in the preview do not stream', () => {
    const onScreen = new Set([2, 3, 4])
    expect(pickStreams({ tabs, onScreen, open: 3, zoomedOut: false, cap: 4 })).toEqual([4, 2])
  })
  test('the cap holds, and zoomed out nothing streams', () => {
    expect(pickStreams({ tabs, onScreen: all, open: null, zoomedOut: false, cap: 2 })).toEqual([
      3, 4
    ])
    expect(pickStreams({ tabs, onScreen: all, open: null, zoomedOut: true, cap: 4 })).toEqual([])
    expect(pickStreams({ tabs, onScreen: all, open: null, zoomedOut: false, cap: 0 })).toEqual([])
  })
})

describe('captureWidth', () => {
  test('sized to the card, more when only part of the page is the video', () => {
    expect(captureWidth(240, 1, 1)).toBe(320) // floor
    expect(captureWidth(240, 1.5, 0.5)).toBe(800) // 720 rounded up to a 160 step
    expect(captureWidth(2000, 2, 0.1)).toBe(1280) // ceiling
  })
  test('small zoom changes keep the same width (no stream restart)', () => {
    expect(captureWidth(250, 1, 0.6)).toBe(captureWidth(260, 1, 0.6))
  })
})

describe('videoRegion', () => {
  test('the picture inside a letterboxed element, as fractions of the viewport', () => {
    // a 1000x500 element at (100, 50) in a 1200x800 viewport, holding a 16:9 video: 888.9 x 500, centered
    const r = videoRegion([100, 50, 1000, 500, 1200, 800, 1920, 1080])!
    expect(r.h).toBeCloseTo(500 / 800)
    expect(r.w).toBeCloseTo(888.89 / 1200, 3)
    expect(r.x).toBeCloseTo((100 + 55.56) / 1200, 3)
    expect(r.y).toBeCloseTo(50 / 800)
  })
  test('clipped to the viewport', () => {
    const r = videoRegion([-100, -100, 600, 400, 1000, 1000, 600, 400])!
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    expect(r.w).toBeCloseTo(0.5)
    expect(r.h).toBeCloseTo(0.3)
  })
  test('junk, tiny and off-screen videos are null', () => {
    expect(videoRegion(null)).toBeNull()
    expect(videoRegion('x')).toBeNull()
    expect(videoRegion([1, 2, 3])).toBeNull()
    expect(videoRegion([0, 0, 100, 100, 1000, 1000, NaN, 1])).toBeNull()
    expect(videoRegion([0, 0, 100, 100, 1000, 1000, 16, 9])).toBeNull() // 1% of the page
    expect(videoRegion([2000, 0, 800, 450, 1000, 1000, 16, 9])).toBeNull()
    expect(videoRegion([0, 0, 0, 450, 1000, 1000, 16, 9])).toBeNull()
  })
})

describe('fitRegion', () => {
  test('a wide video in a tall card fills the width, letterboxed', () => {
    // the region is the left half, top half of a 16:9 frame: itself 16:9
    const f = fitRegion({ x: 0, y: 0, w: 0.5, h: 0.5 }, 16 / 9, 240 / 300)
    expect(f.clip.w).toBe(100)
    expect(f.clip.h).toBeCloseTo((240 / 300 / (16 / 9)) * 100)
    expect(f.video).toEqual({ x: -0, y: -0, w: 200, h: 200 })
  })
  test('a tall region in a wide box fills the height', () => {
    const f = fitRegion({ x: 0.25, y: 0, w: 0.25, h: 1 }, 1, 2)
    expect(f.clip.h).toBe(100)
    expect(f.clip.w).toBeCloseTo(12.5)
    expect(f.video.x).toBe(-100)
    expect(f.video.w).toBe(400)
  })
})
