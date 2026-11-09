/**
 * The canvas command menu (/ or Ctrl+K): which commands match what was typed, best first. Pure; the renderer owns the
 * commands themselves. Every word typed must start a word of the label or of its other names ("frame" finds "New
 * section"); a match at the start of the label ranks first.
 */
export interface CommandSpec {
  id: string
  label: string
  /** Other words it answers to. */
  also?: string
}

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

export function matchCommands<T extends CommandSpec>(query: string, list: readonly T[]): T[] {
  const q = words(query)
  if (q.length === 0) return [...list]
  const scored: Array<{ c: T; score: number; i: number }> = []
  list.forEach((c, i) => {
    const label = words(c.label)
    const all = [...label, ...words(c.also ?? '')]
    if (!q.every((w) => all.some((x) => x.startsWith(w)))) return
    // the label itself, from its first word, beats a match on another name
    const score =
      (label[0]?.startsWith(q[0]) ? 0 : 1) +
      (q.every((w) => label.some((x) => x.startsWith(w))) ? 0 : 2)
    scored.push({ c, score, i })
  })
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((x) => x.c)
}
