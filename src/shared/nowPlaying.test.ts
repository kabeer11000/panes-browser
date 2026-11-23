import { describe, expect, test } from 'bun:test'
import {
  forgetPlaying,
  nextPlaying,
  NO_PLAYING,
  PLAYING_MAX,
  shownPlaying,
  type PlayingFacts
} from './nowPlaying'

const f = (id: number, x: Partial<PlayingFacts> = {}): PlayingFacts => ({
  id,
  sounding: false,
  muted: false,
  media: false,
  call: false,
  ...x
})

describe('nextPlaying', () => {
  test('a tab that starts playing is listed, newest first; a quiet one is not', () => {
    let l = nextPlaying(NO_PLAYING, [f(1, { sounding: true }), f(2)])
    expect(l.ids).toEqual([1])
    l = nextPlaying(l, [f(1, { sounding: true }), f(2, { media: true })])
    expect(l.ids).toEqual([2, 1])
  })
  test('a paused one stays listed; playing again brings it to the front', () => {
    let l = nextPlaying(NO_PLAYING, [f(1, { sounding: true }), f(2)])
    l = nextPlaying(l, [f(1, { sounding: true }), f(2, { sounding: true })])
    l = nextPlaying(l, [f(1), f(2)]) // both paused
    expect(l.ids).toEqual([2, 1])
    l = nextPlaying(l, [f(1, { sounding: true }), f(2)])
    expect(l.ids).toEqual([1, 2])
  })
  test('a call counts, silent or not', () => {
    expect(nextPlaying(NO_PLAYING, [f(5, { call: true })]).ids).toEqual([5])
  })
  test('a closed tab goes', () => {
    const l = nextPlaying(NO_PLAYING, [f(1, { sounding: true }), f(2, { sounding: true })])
    expect(nextPlaying(l, [f(2, { sounding: true })]).ids).toEqual([2])
  })
  test('nothing changed: the same list back', () => {
    const l = nextPlaying(NO_PLAYING, [f(1, { sounding: true })])
    expect(nextPlaying(l, [f(1, { sounding: true })])).toBe(l)
  })
  test('the oldest go past the limit', () => {
    let l = NO_PLAYING
    const all: PlayingFacts[] = []
    for (let i = 1; i <= PLAYING_MAX + 3; i++) {
      all.push(f(i))
      l = nextPlaying(
        l,
        all.map((x) => (x.id === i ? f(i, { sounding: true }) : x))
      )
    }
    expect(l.ids.length).toBe(PLAYING_MAX)
    expect(l.ids[0]).toBe(PLAYING_MAX + 3)
    expect(l.ids).not.toContain(1)
  })
})

describe('forgetting', () => {
  test('a forgotten one is not shown until it plays again', () => {
    let l = nextPlaying(NO_PLAYING, [f(1, { sounding: true }), f(2, { sounding: true })])
    l = nextPlaying(l, [f(1), f(2, { sounding: true })])
    l = forgetPlaying(l, 1)
    expect(shownPlaying(l, [f(1), f(2, { sounding: true })])).toEqual([2])
    l = nextPlaying(l, [f(1, { sounding: true }), f(2, { sounding: true })])
    expect(shownPlaying(l, [f(1, { sounding: true }), f(2, { sounding: true })])).toEqual([1, 2])
  })
})

describe('shownPlaying order', () => {
  test('calls first, then what is heard, then the rest newest first', () => {
    const facts = [
      f(1, { sounding: true, muted: true }),
      f(2),
      f(3, { sounding: true }),
      f(4, { call: true })
    ]
    const l = { ids: [2, 1, 3, 4], forgot: [], active: [1, 3, 4] }
    expect(shownPlaying(l, facts)).toEqual([4, 3, 2, 1])
  })
})
