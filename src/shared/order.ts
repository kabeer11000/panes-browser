/**
 * Lists the person puts in order by dragging (spaces). Pure, so it is tested.
 */

/** `ids` with `id` moved to `to` (clamped to the list); the same array back when nothing moves. */
export function moveId<T>(ids: readonly T[], id: T, to: number): readonly T[] {
  const from = ids.indexOf(id)
  if (from < 0) return ids
  const at = Math.max(0, Math.min(ids.length - 1, Math.round(to)))
  if (at === from) return ids
  const rest = ids.filter((x) => x !== id)
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

/**
 * Where a dragged item lands among the others: before the first whose middle is past the pointer, along the row's
 * axis. `middles` are the other items' middles in their order (the dragged one left out).
 */
export function dropIndex(middles: readonly number[], pointer: number): number {
  const i = middles.findIndex((m) => pointer < m)
  return i < 0 ? middles.length : i
}

/** Whether two id lists hold the same ids in the same order. */
export function sameOrder<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
