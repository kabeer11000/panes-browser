import { describe, expect, test } from 'bun:test'
import {
  applyDrop,
  computeFrames,
  insertAtRoot,
  insertTab,
  leaf,
  leaves,
  moveLeaf,
  normalizeLayout,
  removeTab,
  replaceLeaf,
  rowOf,
  setRatios,
  swapLeaves,
  type LayoutNode
} from './layout'

const sum = (r: number[]): number => r.reduce((a, b) => a + b, 0)

describe('rowOf', () => {
  test('one tab is a leaf, several are an even row in order', () => {
    expect(rowOf([7])).toEqual(leaf(7))
    const r = rowOf([3, 1, 2])
    expect(leaves(r)).toEqual([3, 1, 2])
    expect(r.type === 'split' && r.ratios.every((x) => Math.abs(x - 1 / 3) < 1e-9)).toBe(true)
  })
})

describe('insertTab', () => {
  test('first split makes a row', () => {
    const t = insertTab(leaf(1), 1, 2, 'right')
    expect(t).toEqual({
      type: 'split',
      dir: 'row',
      ratios: [0.5, 0.5],
      children: [leaf(1), leaf(2)]
    })
  })
  test('left puts the new tab first', () => {
    expect(leaves(insertTab(leaf(1), 1, 2, 'left'))).toEqual([2, 1])
  })
  test('same axis adds a sibling and halves the target share', () => {
    const t = insertTab(insertTab(leaf(1), 1, 2, 'right'), 2, 3, 'right')
    expect(t.type === 'split' && t.dir).toBe('row')
    expect(leaves(t)).toEqual([1, 2, 3])
    if (t.type === 'split') {
      expect(t.ratios).toEqual([0.5, 0.25, 0.25])
      expect(sum(t.ratios)).toBeCloseTo(1)
    }
  })
  test('other axis nests a column inside the row', () => {
    const t = insertTab(insertTab(leaf(1), 1, 2, 'right'), 2, 3, 'bottom')
    expect(leaves(t)).toEqual([1, 2, 3])
    if (t.type !== 'split') throw new Error('expected split')
    expect(t.dir).toBe('row')
    expect(t.children[1]).toMatchObject({ type: 'split', dir: 'col' })
  })
})

describe('removeTab', () => {
  test('collapses a two-leaf split to the survivor', () => {
    expect(removeTab(insertTab(leaf(1), 1, 2, 'right'), 2)).toEqual(leaf(1))
  })
  test('renormalizes the remaining ratios', () => {
    const t = insertTab(insertTab(leaf(1), 1, 2, 'right'), 2, 3, 'right')
    const r = removeTab(t, 1)
    expect(r && r.type === 'split' && sum(r.ratios)).toBeCloseTo(1)
    expect(r && leaves(r)).toEqual([2, 3])
  })
  test('merges a nested same-direction split back into its parent', () => {
    // row[1, col[2,3]] -> remove 3 -> col collapses to 2 -> row[1,2]
    const t = insertTab(insertTab(leaf(1), 1, 2, 'right'), 2, 3, 'bottom')
    const r = removeTab(t, 3) as LayoutNode
    expect(r).toMatchObject({ type: 'split', dir: 'row' })
    expect(leaves(r)).toEqual([1, 2])
    if (r.type === 'split') expect(r.children.every((c) => c.type === 'leaf')).toBe(true)
  })
  test('removing the only tab gives null', () => {
    expect(removeTab(leaf(1), 1)).toBeNull()
  })
})

describe('moveLeaf / swap / replace', () => {
  const three = insertTab(insertTab(leaf(1), 1, 2, 'right'), 2, 3, 'right')
  test('move to another edge keeps every tab exactly once', () => {
    const t = moveLeaf(three, 1, 3, 'bottom')
    expect([...leaves(t)].sort()).toEqual([1, 2, 3])
  })
  test('moving onto itself is a no-op', () => {
    expect(moveLeaf(three, 2, 2, 'left')).toBe(three)
  })
  test('swap exchanges positions', () => {
    expect(leaves(swapLeaves(three, 1, 3))).toEqual([3, 2, 1])
  })
  test('replace swaps a leaf for a new tab', () => {
    expect(leaves(replaceLeaf(three, 2, 9))).toEqual([1, 9, 3])
  })
})

describe('setRatios / normalizeLayout', () => {
  const two = insertTab(leaf(1), 1, 2, 'right')
  test('applies and normalizes ratios at the root', () => {
    const t = setRatios(two, [], [3, 1])
    expect(t.type === 'split' && t.ratios).toEqual([0.75, 0.25])
  })
  test('rejects wrong length or non-positive values', () => {
    expect(setRatios(two, [], [1])).toBe(two)
    expect(setRatios(two, [], [1, 0])).toBe(two)
    expect(setRatios(two, [], [1, Number.NaN])).toBe(two)
  })
  test('follows a path into nested splits', () => {
    const nested = insertTab(two, 2, 3, 'bottom')
    const t = setRatios(nested, [1], [0.8, 0.2])
    if (t.type !== 'split') throw new Error('expected split')
    const inner = t.children[1]
    expect(inner.type === 'split' && inner.ratios).toEqual([0.8, 0.2])
  })
  test('a lone tab is not a layout', () => {
    expect(normalizeLayout(leaf(1))).toBeNull()
    expect(normalizeLayout(null)).toBeNull()
    expect(normalizeLayout(two)).toBe(two)
  })
})

describe('insertAtRoot', () => {
  const two = insertTab(leaf(1), 1, 2, 'right')
  test('same axis adds a full-height sibling and scales the rest', () => {
    const t = insertAtRoot(two, 3, 'right', 0.25)
    if (t.type !== 'split') throw new Error('expected split')
    expect(leaves(t)).toEqual([1, 2, 3])
    expect(t.ratios).toEqual([0.375, 0.375, 0.25])
  })
  test('other axis wraps the whole layout', () => {
    const t = insertAtRoot(two, 3, 'top', 0.25)
    if (t.type !== 'split') throw new Error('expected split')
    expect(t.dir).toBe('col')
    expect(leaves(t)).toEqual([3, 1, 2])
    expect(t.children[1]).toBe(two)
  })
})

describe('computeFrames', () => {
  const area = { x: 0, y: 0, w: 1014, h: 600 }
  test('a single tab fills the area', () => {
    expect(computeFrames(leaf(1), area, 14).leaves.get(1)).toEqual(area)
  })
  test('siblings share the area minus gaps and divide it by ratio', () => {
    const { leaves: f, dividers } = computeFrames(insertTab(leaf(1), 1, 2, 'right'), area, 14)
    expect(f.get(1)).toEqual({ x: 0, y: 0, w: 500, h: 600 })
    expect(f.get(2)).toEqual({ x: 514, y: 0, w: 500, h: 600 })
    expect(dividers).toHaveLength(1)
    expect(dividers[0].frame).toEqual({ x: 500, y: 0, w: 14, h: 600 })
  })
  test('nested columns tile the right half', () => {
    const t = insertTab(insertTab(leaf(1), 1, 2, 'right'), 2, 3, 'bottom')
    const { leaves: f, dividers } = computeFrames(t, area, 14)
    expect(f.get(2)).toEqual({ x: 514, y: 0, w: 500, h: 293 })
    expect(f.get(3)).toEqual({ x: 514, y: 307, w: 500, h: 293 })
    expect(dividers.map((d) => d.dir).sort()).toEqual(['col', 'row'])
  })
})

describe('applyDrop', () => {
  const two = insertTab(leaf(1), 1, 2, 'right')
  test('a new tab dropped on a lone pane tiles beside it', () => {
    expect(leaves(applyDrop(null, 2, 1, 'left') as LayoutNode)).toEqual([2, 1])
  })
  test('centre swaps tabs already tiled', () => {
    expect(leaves(applyDrop(two, 1, 2, 'center') as LayoutNode)).toEqual([2, 1])
  })
  test('moving a tiled tab to another edge keeps all tabs', () => {
    const three = insertTab(two, 2, 3, 'right')
    const t = applyDrop(three, 1, 3, 'bottom') as LayoutNode
    expect([...leaves(t)].sort()).toEqual([1, 2, 3])
  })
  test('dropping on itself changes nothing', () => {
    expect(applyDrop(two, 1, 1, 'left')).toBe(two)
  })
  test('root docking wraps or extends the whole layout', () => {
    expect(leaves(applyDrop(two, 3, -1, 'top') as LayoutNode)).toEqual([3, 1, 2])
  })
})
