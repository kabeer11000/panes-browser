// The board's recent-use glow: where you have just been, fading with time. Never red, never counted: that is how
// notifications speak, and this must not be read as one. Pure so it can be tested; the board (Canvas.tsx) draws it.

/** How warm a card is: 3 just used, 2 within the hour, 1 within a few hours. */
export type Heat = 1 | 2 | 3

const WARM_MS = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000] as const
/** At most this many cards glow: a trail to follow, not a board lit up (and few soft shadows to draw). */
export const MAX_WARM = 8

/** The tabs that glow and how warmly: the MAX_WARM used most recently within the last few hours. */
export function recentHeat(
  tabs: ReadonlyArray<{ id: number; usedAt: number }>,
  now: number,
  max = MAX_WARM
): Map<number, Heat> {
  const out = new Map<number, Heat>()
  const recent = tabs
    .filter((t) => t.usedAt > 0 && now - t.usedAt < WARM_MS[2])
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, max)
  for (const t of recent) {
    const age = now - t.usedAt
    out.set(t.id, age < WARM_MS[0] ? 3 : age < WARM_MS[1] ? 2 : 1)
  }
  return out
}
