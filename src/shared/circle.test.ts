import { describe, expect, test } from 'bun:test'
import {
  boxOf,
  boxPolygon,
  inPolygon,
  isTap,
  multipartFile,
  scalePts,
  SHAKE_MS,
  SHAKE_TURNS,
  ShakeWatch
} from './circle'

describe('lasso geometry', () => {
  test('box around points', () => {
    expect(
      boxOf([
        { x: 5, y: 9 },
        { x: 1, y: 20 },
        { x: 8, y: 2 }
      ])
    ).toEqual({ x: 1, y: 2, width: 7, height: 18 })
    expect(boxOf([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
  test('a tiny stroke is a tap', () => {
    expect(
      isTap([
        { x: 10, y: 10 },
        { x: 14, y: 12 }
      ])
    ).toBe(true)
    expect(
      isTap([
        { x: 10, y: 10 },
        { x: 60, y: 12 }
      ])
    ).toBe(false)
  })
  test('inside a polygon, including a concave one', () => {
    const square = boxPolygon({ x: 0, y: 0, width: 10, height: 10 })
    expect(inPolygon({ x: 5, y: 5 }, square)).toBe(true)
    expect(inPolygon({ x: 15, y: 5 }, square)).toBe(false)
    // a U shape: the gap in the middle is outside
    const u = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 7 },
      { x: 7, y: 7 },
      { x: 7, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]
    expect(inPolygon({ x: 5, y: 3 }, u)).toBe(false)
    expect(inPolygon({ x: 1, y: 3 }, u)).toBe(true)
    expect(inPolygon({ x: 5, y: 9 }, u)).toBe(true)
  })
  test('screen points become page points at the page zoom', () => {
    expect(scalePts([{ x: 150, y: 300 }], 1 / 1.5)).toEqual([{ x: 100, y: 200 }])
  })
})

describe('mouse shake', () => {
  /** x positions every 16 ms: legs of `leg` px, `legs` of them, `steps` moves per leg */
  const wave = (w: ShakeWatch, legs: number, leg: number, steps = 4, t0 = 0): boolean => {
    let x = 500
    let t = t0
    let dir = 1
    let hit = false
    for (let i = 0; i < legs; i++) {
      for (let s = 0; s < steps; s++) {
        x += (dir * leg) / steps
        t += 16
        hit = w.move(x, t) || hit
      }
      dir = -dir
    }
    return hit
  }
  test('a fast wave of long strokes is a shake', () => {
    expect(wave(new ShakeWatch(), 7, 80)).toBe(true)
  })
  test('a real hand: eased strokes with a pixel of jitter', () => {
    // a sine wave sampled every 8 ms (a 125 Hz mouse), ~5 strokes a second, x jittering by a pixel
    const w = new ShakeWatch()
    let hit = false
    for (let t = 0; t < 1200; t += 8) {
      const x = 500 + 70 * Math.sin((t / 200) * Math.PI) + (t % 24 === 0 ? -1 : 1)
      hit = w.move(Math.round(x), t) || hit
    }
    expect(hit).toBe(true)
  })
  test('small wobbles are not', () => {
    expect(wave(new ShakeWatch(), 12, 15)).toBe(false)
  })
  test('the same strokes made slowly are not', () => {
    // each leg takes 40 moves of 16 ms = 640 ms: five turns never fall inside the window
    expect(wave(new ShakeWatch(), 7, 80, 40)).toBe(false)
    expect(SHAKE_MS).toBeLessThan(5 * 640)
  })
  test('moving one way is not a shake', () => {
    const w = new ShakeWatch()
    let hit = false
    for (let i = 0; i < 100; i++) hit = w.move(i * 20, i * 16) || hit
    expect(hit).toBe(false)
  })
  test('after a shake it starts over', () => {
    const w = new ShakeWatch()
    expect(wave(w, SHAKE_TURNS + 1, 80)).toBe(true)
    expect(wave(w, 2, 80, 4, 1000)).toBe(false)
  })
})

describe('upload body', () => {
  test('one file field, framed by the boundary', () => {
    const body = new TextDecoder().decode(
      multipartFile('encoded_image', 'a.jpg', 'image/jpeg', new Uint8Array([65, 66]), 'XYZ')
    )
    expect(body).toBe(
      '--XYZ\r\nContent-Disposition: form-data; name="encoded_image"; filename="a.jpg"\r\n' +
        'Content-Type: image/jpeg\r\n\r\nAB\r\n--XYZ--\r\n'
    )
  })
})
