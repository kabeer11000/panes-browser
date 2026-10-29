/**
 * Seeded pseudo-random input for the fuzz tests (mulberry32). The same seed always gives the same
 * sequence, so a seed printed by a failing test reproduces the exact input.
 */

export interface Rng {
  /** A float in [0, 1). */
  next(): number
  /** An integer in [0, max). */
  int(max: number): number
  /** An element of a non-empty array. */
  pick<T>(items: readonly T[]): T
  /** A coin flip, or true with probability p. */
  bool(p?: number): boolean
  /** True with probability p. */
  chance(p: number): boolean
  /** A string of `len` characters drawn from `alphabet` (code points, so unicode alphabets work). */
  str(len: number, alphabet?: string): string
}

export const ASCII =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'

export function rng(seed: number): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (max: number): number => Math.floor(next() * max)
  const chance = (p: number): boolean => next() < p
  return {
    next,
    int,
    pick: (items) => items[int(items.length)],
    bool: (p = 0.5) => chance(p),
    chance,
    str: (len, alphabet = ASCII) => {
      const chars = Array.from(alphabet)
      let out = ''
      for (let i = 0; i < len; i++) out += chars[int(chars.length)]
      return out
    }
  }
}

/** `n` fixed seeds, the same list on every run. */
export function seedList(n: number, base = 1): number[] {
  return Array.from({ length: n }, (_, i) => base + i * 7919)
}

/** Throws with `msg` when `cond` is false. Used instead of expect() so the message can carry the input. */
export function ensure(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

/** A value as text for a failure message; never throws. */
export function show(v: unknown): string {
  try {
    const s = JSON.stringify(v, (_k, x: unknown) =>
      x instanceof Set ? [...x] : x instanceof Map ? Object.fromEntries(x) : x
    )
    return s === undefined ? String(v) : s
  } catch {
    return String(v)
  }
}

/**
 * Runs `body` once per seed. A failure is rethrown with the seed and the operations logged so far,
 * so `fuzz` output alone is enough to reproduce it.
 */
export function fuzz(seeds: readonly number[], body: (r: Rng, log: string[]) => void): void {
  for (const seed of seeds) {
    const log: string[] = []
    try {
      body(rng(seed), log)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`fuzz seed=${seed}: ${msg}\nlast ops: ${log.slice(-40).join(' | ')}`, {
        cause: err
      })
    }
  }
}
