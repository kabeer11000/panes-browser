import { describe, expect, test } from 'bun:test'
import {
  captureWidth,
  fitRegion,
  pickStreams,
  streamCap,
  streamFps,
  keepCapture,
  liveTier,
  tierFps,
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

describe('pickStreams with calls', () => {
  test('a tab in a call streams even when silent, and before anything playing', () => {
    const list = [
      { id: 1, audible: true, muted: false },
      { id: 2, audible: false, muted: false, call: true },
      { id: 3, audible: false, muted: false }
    ]
    const on = new Set([1, 2, 3])
    expect(pickStreams({ tabs: list, onScreen: on, open: null, zoomedOut: false, cap: 1 })).toEqual(
      [2]
    )
    expect(pickStreams({ tabs: list, onScreen: on, open: null, zoomedOut: false, cap: 4 })).toEqual(
      [2, 1]
    )
    expect(pickStreams({ tabs: list, onScreen: on, open: 2, zoomedOut: false, cap: 4 })).toEqual([
      1
    ])
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
  test('a 16:9 video in a 16:10 tab letterboxed into a 1:1 capture frame preserves 16:9 and never crops below the player', () => {
    const r = videoRegion([64, 56, 854, 480, 1280, 800, 1920, 1080])!
    expect(r.pageAspect).toBeCloseTo(1.6)
    const fSquare = fitRegion(r, 1, 16 / 9)
    const fMatch = fitRegion(r, 1.6, 16 / 9)
    // Both must recognize the video as 16:9 and fill a 16:9 card completely
    expect(fSquare.clip.w).toBeCloseTo(100, 1)
    expect(fSquare.clip.h).toBeCloseTo(100, 1)
    expect(fMatch.clip.w).toBeCloseTo(100, 1)
    expect(fMatch.clip.h).toBeCloseTo(100, 1)
    // In the letterboxed 1:1 frame, the page starts at y = 0.1875, so the video's top offset is shifted deeper than in a 1.6 frame
    expect(fSquare.video.y).toBeLessThan(fMatch.video.y)
  })
})

describe('liveTier', () => {
  test('by share of the window: small, medium, large', () => {
    expect(liveTier(0.15, null)).toBe(0)
    expect(liveTier(0.25, null)).toBe(1)
    expect(liveTier(0.5, null)).toBe(2)
  })
  test('up at once, down only clearly below', () => {
    expect(liveTier(0.36, 1)).toBe(2)
    expect(liveTier(0.33, 2)).toBe(2) // just under: holds
    expect(liveTier(0.27, 2)).toBe(1) // under 0.35 * 0.8
    expect(liveTier(0.15, 1)).toBe(0)
  })
  test('frames per tier', () => {
    expect(tierFps(0, 4)).toBe(10)
    expect(tierFps(1, 4)).toBe(15)
    expect(tierFps(2, 4)).toBe(streamFps(4))
  })
})

describe('pickStreams by size', () => {
  const tabs = [
    { id: 1, audible: true, muted: false },
    { id: 2, audible: true, muted: false },
    { id: 3, audible: false, muted: true },
    { id: 4, audible: false, muted: false, call: true }
  ]
  const base = { tabs, onScreen: new Set([1, 2, 3, 4]), open: null, zoomedOut: false, cap: 4 }
  test('a card too small on screen is not streamed, unless it is a call', () => {
    const cardPx = new Map([
      [1, 100],
      [2, 400],
      [3, 500],
      [4, 50]
    ])
    expect(pickStreams({ ...base, cardPx, screenW: 1600 })).toEqual([4, 2, 3])
  })
  test('the larger cards first, among equals', () => {
    const cardPx = new Map([
      [1, 300],
      [2, 900]
    ])
    expect(pickStreams({ ...base, tabs: tabs.slice(0, 2), cap: 1, cardPx, screenW: 1600 })).toEqual(
      [2]
    )
  })
})

describe('keepCapture', () => {
  test('starts at what is asked', () => {
    expect(keepCapture(0, 640)).toBe(640)
  })
  test('grows at once when the card needs it sharper', () => {
    expect(keepCapture(640, 800)).toBe(800)
  })
  test('a little smaller keeps the running stream; half or less shrinks it', () => {
    expect(keepCapture(800, 640)).toBe(800)
    expect(keepCapture(800, 480)).toBe(800)
    expect(keepCapture(800, 400)).toBe(400)
  })
  test('nothing asked: nothing', () => {
    expect(keepCapture(800, 0)).toBe(0)
  })
})
