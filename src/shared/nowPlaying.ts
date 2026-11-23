/**
 * Now playing, across every space (the island on the board, in its preview and in the tab view's top bar): the tabs
 * making sound, playing media or in a call, kept listed while paused (a paused video is silent, yet you want it
 * back) until dismissed, closed, or pushed out by newer ones. Main keeps the list; every view shows it.
 */

/** What a tab is doing this moment. */
export interface PlayingFacts {
  id: number
  /** Making sound now (muted or not). */
  sounding: boolean
  muted: boolean
  /** Its media plays (a muted or quiet video too). */
  media: boolean
  /** Camera, microphone or screen in use: a call. */
  call: boolean
}

export interface PlayingList {
  /** Tab ids, the most recently started first. */
  ids: number[]
  /** Taken off the list by the person (until they play again). */
  forgot: number[]
  /** The tabs active at the last look, to tell when one starts. */
  active: number[]
}

export const NO_PLAYING: PlayingList = { ids: [], forgot: [], active: [] }

/** How many are kept: the oldest paused ones go past it. */
export const PLAYING_MAX = 12

const isActive = (f: PlayingFacts): boolean => f.sounding || f.media || f.call

/**
 * The list after a look at the tabs (`facts`: every tab there is). A tab that starts is put at the front (and is no
 * longer forgotten); a tab that closed goes. Returns `prev` itself when nothing changed.
 */
export function nextPlaying(prev: PlayingList, facts: readonly PlayingFacts[]): PlayingList {
  const live = new Set(facts.map((f) => f.id))
  const active = facts.filter(isActive).map((f) => f.id)
  const started = active.filter((id) => !prev.active.includes(id))
  let ids = prev.ids.filter((id) => live.has(id))
  if (started.length) ids = [...started, ...ids.filter((id) => !started.includes(id))]
  ids = ids.slice(0, PLAYING_MAX)
  const forgot = prev.forgot.filter((id) => live.has(id) && !started.includes(id))
  const same = (a: number[], b: number[]): boolean =>
    a.length === b.length && a.every((x, i) => x === b[i])
  if (same(ids, prev.ids) && same(forgot, prev.forgot) && same(active, prev.active)) return prev
  return { ids, forgot, active }
}

/** Taken off the list by the person (only a paused one is offered; one playing comes back as it plays on). */
export function forgetPlaying(prev: PlayingList, id: number): PlayingList {
  return prev.forgot.includes(id) ? prev : { ...prev, forgot: [...prev.forgot, id] }
}

/**
 * What the island shows, in order: calls first, then what is heard (sounding and not muted), then the rest as listed
 * (the most recently started first). Forgotten ones are left out.
 */
export function shownPlaying(list: PlayingList, facts: readonly PlayingFacts[]): number[] {
  const by = new Map(facts.map((f) => [f.id, f]))
  const rank = (id: number): number => {
    const f = by.get(id)
    if (!f) return 0
    return f.call ? 2 : f.sounding && !f.muted ? 1 : 0
  }
  return list.ids
    .filter((id) => by.has(id) && !list.forgot.includes(id))
    .map((id, i) => ({ id, i, r: rank(id) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.id)
}
