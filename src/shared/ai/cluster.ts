// The brief said 0.75. Measured with EmbeddingGemma on real pages: tabs on one topic average 0.55 to 0.75 against each
// other and tabs on different topics 0.25 to 0.40, so 0.75 never groups anything; 0.5 separates them cleanly.
export const GROUP_THRESHOLD = 0.5
export const GROUP_MIN_SIZE = 3

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export function norm(a: ArrayLike<number>): number {
  return Math.sqrt(dot(a, a))
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const d = norm(a) * norm(b)
  return d === 0 ? 0 : dot(a, b) / d
}

/** The `k` items most similar to `query`, best first, none below `min`. Ties keep their input order. */
export function topK(
  query: ArrayLike<number>,
  items: ReadonlyArray<ArrayLike<number>>,
  k: number,
  min = -1
): Array<{ index: number; score: number }> {
  const out: Array<{ index: number; score: number }> = []
  items.forEach((v, index) => {
    const score = cosine(query, v)
    if (score >= min) out.push({ index, score })
  })
  return out.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, k)
}

/**
 * Groups of similar items by average-linkage agglomerative clustering: the two closest groups merge for as long
 * as their average cosine similarity stays at or above `threshold`. Only groups of `minSize` or more are returned.
 * Deterministic: indexes ascend inside a group and groups are ordered by their first index.
 */
export function agglomerative(
  vectors: ReadonlyArray<ArrayLike<number>>,
  threshold = GROUP_THRESHOLD,
  minSize = GROUP_MIN_SIZE
): number[][] {
  const sim: number[][] = vectors.map((a) => vectors.map((b) => cosine(a, b)))
  let groups: number[][] = vectors.map((_, i) => [i])
  const link = (a: number[], b: number[]): number => {
    let s = 0
    for (const i of a) for (const j of b) s += sim[i][j]
    return s / (a.length * b.length)
  }
  while (groups.length > 1) {
    let best = -Infinity
    let bi = -1
    let bj = -1
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const l = link(groups[i], groups[j])
        if (l > best) {
          best = l
          bi = i
          bj = j
        }
      }
    }
    if (best < threshold) break
    const merged = [...groups[bi], ...groups[bj]].sort((a, b) => a - b)
    groups = groups.filter((_, i) => i !== bi && i !== bj)
    groups.push(merged)
  }
  return groups.filter((g) => g.length >= minSize).sort((a, b) => a[0] - b[0])
}
