import { describe, expect, test } from 'bun:test'
import { landingCard, type LandingBox } from './landing'
import { Camera } from './boardPhysics'

const screen = { w: 1000, h: 800 }
const card = (
  id: number,
  x: number,
  y: number,
  w = 600,
  h = 400
): { id: number; box: LandingBox } => ({ id, box: { x, y, w, h } })

describe('landingCard', () => {
  test('the card under the middle of the window, big enough', () => {
    // board at k=1, offset 0: the middle is (500, 400)
    expect(landingCard([card(1, 200, 200)], { x: 0, y: 0, k: 1 }, screen)).toBe(1)
  })
  test('too small where it rests: not landed on', () => {
    expect(landingCard([card(1, 200, 200)], { x: 0, y: 0, k: 0.5 }, screen)).toBeNull()
  })
  test('not under the middle', () => {
    expect(landingCard([card(1, 2000, 2000)], { x: 0, y: 0, k: 1 }, screen)).toBeNull()
  })
  test('of overlapping cards, the nearest middle', () => {
    const cards = [card(1, 0, 0, 900, 800), card(2, 250, 150, 500, 500)]
    expect(landingCard(cards, { x: 0, y: 0, k: 1 }, screen, 0.4)).toBe(2)
  })
  test('nothing for a degenerate view', () => {
    expect(landingCard([card(1, 0, 0)], { x: 0, y: 0, k: 0 }, screen)).toBeNull()
  })
})

describe('Camera.restingView', () => {
  test('a still camera rests where it is', () => {
    const c = new Camera({ x: 10, y: 20, k: 1 }, 0.1, 4)
    expect(c.restingView).toEqual({ x: 10, y: 20, k: 1 })
  })
  test('a coast runs out about v * tau further, and the forecast holds as it steps', () => {
    const c = new Camera({ x: 0, y: 0, k: 1 }, 0.1, 4)
    c.coast(1000, 0, 0.3)
    expect(c.restingView.x).toBeCloseTo(300)
    for (let i = 0; i < 300 && c.moving; i++) c.step(1 / 60)
    expect(Math.abs(c.x - 300)).toBeLessThan(5)
  })
  test('a glide rests at its target', () => {
    const c = new Camera({ x: 0, y: 0, k: 1 }, 0.1, 4)
    c.glideTo({ x: 50, y: -40, k: 2 }, { response: 0.4, damping: 1 })
    const r = c.restingView
    expect(r.x).toBeCloseTo(50)
    expect(r.y).toBeCloseTo(-40)
    expect(r.k).toBeCloseTo(2)
  })
  test('a zoom about a point keeps that point put', () => {
    const c = new Camera({ x: 0, y: 0, k: 1 }, 0.1, 4)
    c.zoomBy(Math.log(2), 100, 100, { response: 0.3, damping: 1 })
    const r = c.restingView
    expect(r.k).toBeCloseTo(2)
    // board point (100,100) stays at screen (100,100): x = 100 - 100*2
    expect(r.x).toBeCloseTo(-100)
    expect(r.y).toBeCloseTo(-100)
  })
})
