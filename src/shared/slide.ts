export interface Edges {
  start: number
  end: number
}

/**
 * How far each row slides while rows `from..from+count-1` are dragged to sit before row `to`: the rows they
 * pass move back by the size of the dragged block, and the block itself moves by the size of the rows passed.
 * `rows` are the rows' edges along the list's axis, in order.
 */
export function slideOffsets(
  rows: readonly Edges[],
  from: number,
  count: number,
  to: number
): number[] {
  const out = rows.map(() => 0)
  const last = from + count - 1
  if (count < 1 || last >= rows.length || (to >= from && to <= from + count)) return out
  if (to > last) {
    // forward: rows after the block, up to the slot, slide back over it; the block moves forward over them
    const back = rows[last + 1].start - rows[from].start
    const ahead = rows[to - 1].end - rows[last].end
    for (let i = last + 1; i < to; i++) out[i] = -back
    for (let i = from; i <= last; i++) out[i] = ahead
  } else {
    // backward: rows from the slot up to the block slide forward past it; the block moves back over them
    const forward = rows[last].end - rows[from].start + (rows[from].start - rows[from - 1].end)
    const back = rows[from].start - rows[to].start
    for (let i = to; i < from; i++) out[i] = forward
    for (let i = from; i <= last; i++) out[i] = -back
  }
  return out
}
