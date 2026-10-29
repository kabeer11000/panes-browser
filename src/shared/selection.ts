export interface Selection {
  ids: ReadonlySet<number>
  /** The row a Shift-click extends from: the last one clicked on its own. */
  anchor: number | null
}

export const NONE: Selection = { ids: new Set(), anchor: null }

/** Every id from `a` to `b` in list order, both ends included, whichever comes first. */
export function between(order: readonly number[], a: number, b: number): number[] {
  const i = order.indexOf(a)
  const j = order.indexOf(b)
  if (i === -1 || j === -1) return [b]
  return order.slice(Math.min(i, j), Math.max(i, j) + 1)
}

/**
 * How a click on a row changes the selection, as in a file manager: Ctrl toggles that row, Shift
 * selects the run from the anchor (added to the selection when Ctrl is held too, else replacing it),
 * and a plain click toggles it alone while rows are selected.
 */
export function click(
  sel: Selection,
  order: readonly number[],
  id: number,
  mods: { shift: boolean; ctrl: boolean }
): Selection {
  if (mods.shift && sel.anchor !== null) {
    const run = between(order, sel.anchor, id)
    const ids = new Set(mods.ctrl ? [...sel.ids, ...run] : run)
    return { ids, anchor: sel.anchor } // the anchor stays, so the run can be stretched or shrunk
  }
  const ids = new Set(sel.ids)
  if (!ids.delete(id)) ids.add(id)
  return { ids, anchor: id }
}

export const all = (order: readonly number[]): Selection => ({
  ids: new Set(order),
  anchor: order[0] ?? null
})
