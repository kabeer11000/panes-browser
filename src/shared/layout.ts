/**
 * Tiling layout: a tree of rows/columns whose leaves are tabs. All functions are pure and
 * return new trees, so main can hold the tree and the renderer can render it directly.
 */
export type Edge = 'left' | 'right' | 'top' | 'bottom'

export interface Leaf {
  type: 'leaf'
  tabId: number
}
export interface SplitNode {
  type: 'split'
  dir: 'row' | 'col'
  /** Share of the container each child takes; always sums to 1. */
  ratios: number[]
  children: LayoutNode[]
}
export type LayoutNode = Leaf | SplitNode

export const leaf = (tabId: number): Leaf => ({ type: 'leaf', tabId })

export function leaves(n: LayoutNode): number[] {
  return n.type === 'leaf' ? [n.tabId] : n.children.flatMap(leaves)
}

const dirOf = (e: Edge): 'row' | 'col' => (e === 'left' || e === 'right' ? 'row' : 'col')
const isAfter = (e: Edge): boolean => e === 'right' || e === 'bottom'

function normalize(ratios: number[]): number[] {
  const sum = ratios.reduce((a, b) => a + b, 0)
  return sum > 0 ? ratios.map((r) => r / sum) : ratios.map(() => 1 / ratios.length)
}

/** A row inside a row (or column inside a column) is just more siblings; merge them. */
function flatten(n: SplitNode): SplitNode {
  const children: LayoutNode[] = []
  const ratios: number[] = []
  n.children.forEach((c, i) => {
    if (c.type === 'split' && c.dir === n.dir) {
      c.children.forEach((cc, j) => {
        children.push(cc)
        ratios.push(n.ratios[i] * c.ratios[j])
      })
    } else {
      children.push(c)
      ratios.push(n.ratios[i])
    }
  })
  return { ...n, children, ratios: normalize(ratios) }
}

/** Put newId beside targetId on the given edge. */
export function insertTab(
  root: LayoutNode,
  targetId: number,
  newId: number,
  edge: Edge
): LayoutNode {
  const dir = dirOf(edge)
  const place = (n: LayoutNode): LayoutNode => {
    if (n.type === 'leaf') {
      if (n.tabId !== targetId) return n
      const children = isAfter(edge) ? [n, leaf(newId)] : [leaf(newId), n]
      return { type: 'split', dir, ratios: [0.5, 0.5], children }
    }
    const idx = n.children.findIndex((c) => c.type === 'leaf' && c.tabId === targetId)
    if (idx !== -1 && n.dir === dir) {
      const children = [...n.children]
      const ratios = [...n.ratios]
      const share = ratios[idx] / 2 // the new tab takes half of the target's space
      ratios[idx] = share
      const at = isAfter(edge) ? idx + 1 : idx
      children.splice(at, 0, leaf(newId))
      ratios.splice(at, 0, share)
      return { ...n, children, ratios }
    }
    return { ...n, children: n.children.map(place) }
  }
  return place(root)
}

/** Remove a tab; collapses splits left with one child. Null when nothing remains. */
export function removeTab(root: LayoutNode, id: number): LayoutNode | null {
  const strip = (n: LayoutNode): LayoutNode | null => {
    if (n.type === 'leaf') return n.tabId === id ? null : n
    const kept: Array<{ c: LayoutNode; r: number }> = []
    n.children.forEach((c, i) => {
      const s = strip(c)
      if (s) kept.push({ c: s, r: n.ratios[i] })
    })
    if (kept.length === 0) return null
    if (kept.length === 1) return kept[0].c
    return flatten({
      ...n,
      children: kept.map((k) => k.c),
      ratios: normalize(kept.map((k) => k.r))
    })
  }
  return strip(root)
}

/** Move a tab that is already in the tree to a new edge of another tab. */
export function moveLeaf(root: LayoutNode, id: number, targetId: number, edge: Edge): LayoutNode {
  if (id === targetId) return root
  const without = removeTab(root, id)
  if (!without || !leaves(without).includes(targetId)) return root
  return insertTab(without, targetId, id, edge)
}

export function swapLeaves(root: LayoutNode, a: number, b: number): LayoutNode {
  const swap = (n: LayoutNode): LayoutNode => {
    if (n.type === 'leaf') return n.tabId === a ? leaf(b) : n.tabId === b ? leaf(a) : n
    return { ...n, children: n.children.map(swap) }
  }
  return swap(root)
}

/** Swap targetId for newId in place (newId must not already be in the tree). */
export function replaceLeaf(root: LayoutNode, targetId: number, newId: number): LayoutNode {
  const replace = (n: LayoutNode): LayoutNode => {
    if (n.type === 'leaf') return n.tabId === targetId ? leaf(newId) : n
    return { ...n, children: n.children.map(replace) }
  }
  return replace(root)
}

const MIN_RATIO = 0.08

/** Set the ratios of the split found by following child indices in `path`. Ignores bad input. */
export function setRatios(root: LayoutNode, path: number[], ratios: number[]): LayoutNode {
  const apply = (n: LayoutNode, rest: number[]): LayoutNode => {
    if (n.type === 'leaf') return n
    if (rest.length === 0) {
      const ok =
        ratios.length === n.children.length && ratios.every((r) => Number.isFinite(r) && r > 0)
      if (!ok) return n
      return { ...n, ratios: normalize(ratios.map((r) => Math.max(MIN_RATIO, r))) }
    }
    const [i, ...tail] = rest
    if (!n.children[i]) return n
    return { ...n, children: n.children.map((c, j) => (j === i ? apply(c, tail) : c)) }
  }
  return apply(root, path)
}

/** A layout with fewer than two tabs is not a layout. */
export function normalizeLayout(root: LayoutNode | null): LayoutNode | null {
  return root && leaves(root).length >= 2 ? root : null
}

/** dropTab target meaning "the whole layout" rather than one pane. */
export const ROOT_TARGET = -1

/** Dock a tab along an outer edge of the whole layout, giving it `share` of the space. */
export function insertAtRoot(
  root: LayoutNode,
  newId: number,
  edge: Edge,
  share = 0.28
): LayoutNode {
  const dir = dirOf(edge)
  const first = !isAfter(edge)
  if (root.type === 'split' && root.dir === dir) {
    const scaled = root.ratios.map((r) => r * (1 - share))
    return {
      ...root,
      children: first ? [leaf(newId), ...root.children] : [...root.children, leaf(newId)],
      ratios: first ? [share, ...scaled] : [...scaled, share]
    }
  }
  return {
    type: 'split',
    dir,
    ratios: first ? [share, 1 - share] : [1 - share, share],
    children: first ? [leaf(newId), root] : [root, leaf(newId)]
  }
}

export interface Frame {
  x: number
  y: number
  w: number
  h: number
}

export interface DividerFrame {
  /** Child indices leading to the split this divider belongs to. */
  path: number[]
  /** Sits between children `index` and `index + 1`. */
  index: number
  dir: 'row' | 'col'
  frame: Frame
  /** The split's own area, for turning pointer positions into ratios. */
  parent: Frame
  ratios: number[]
}

/** Lay the tree out inside `area`, leaving `gap` px between siblings for dividers. */
export function computeFrames(
  root: LayoutNode,
  area: Frame,
  gap: number
): { leaves: Map<number, Frame>; dividers: DividerFrame[] } {
  const out = new Map<number, Frame>()
  const dividers: DividerFrame[] = []
  const walk = (n: LayoutNode, f: Frame, path: number[]): void => {
    if (n.type === 'leaf') {
      out.set(n.tabId, f)
      return
    }
    const count = n.children.length
    const total = (n.dir === 'row' ? f.w : f.h) - gap * (count - 1)
    let offset = 0
    n.children.forEach((c, i) => {
      const size = total * n.ratios[i]
      walk(
        c,
        n.dir === 'row'
          ? { x: f.x + offset, y: f.y, w: size, h: f.h }
          : { x: f.x, y: f.y + offset, w: f.w, h: size },
        [...path, i]
      )
      offset += size
      if (i < count - 1) {
        dividers.push({
          path,
          index: i,
          dir: n.dir,
          parent: f,
          ratios: n.ratios,
          frame:
            n.dir === 'row'
              ? { x: f.x + offset, y: f.y, w: gap, h: f.h }
              : { x: f.x, y: f.y + offset, w: f.w, h: gap }
        })
        offset += gap
      }
    })
  }
  walk(root, area, [])
  return { leaves: out, dividers }
}

/**
 * The layout that results from dropping `id` on `targetId` (or on the whole layout when
 * targetId is ROOT_TARGET). Used by main to apply drops and by the renderer to preview them.
 * `layout` is the tiled group currently shown, or null when a single tab is shown.
 */
export function applyDrop(
  layout: LayoutNode | null,
  id: number,
  targetId: number,
  edge: Edge | 'center'
): LayoutNode | null {
  if (targetId === ROOT_TARGET) {
    if (!layout || edge === 'center') return layout
    const base = leaves(layout).includes(id) ? removeTab(layout, id) : layout
    return base ? insertAtRoot(base, id, edge) : layout
  }
  if (id === targetId) return layout
  const base = layout && leaves(layout).includes(targetId) ? layout : leaf(targetId)
  const has = leaves(base).includes(id)
  if (edge === 'center')
    return has ? swapLeaves(base, id, targetId) : replaceLeaf(base, targetId, id)
  return has ? moveLeaf(base, id, targetId, edge) : insertTab(base, targetId, id, edge)
}
