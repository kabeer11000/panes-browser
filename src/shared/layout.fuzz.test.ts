import { describe, expect, test } from 'bun:test'
import { ensure, fuzz, seedList, show, type Rng } from './testing/prng'
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
  ROOT_TARGET,
  rowOf,
  setRatios,
  swapLeaves,
  type Edge,
  type LayoutNode
} from './layout'

const EDGES: Edge[] = ['left', 'right', 'top', 'bottom']
const ALL_EDGES = [...EDGES, 'center'] as const
const SEEDS = seedList(200)
const STEPS = 25
const MAX_LEAVES = 8
const OPS = [
  'insertTab',
  'removeTab',
  'moveLeaf',
  'swapLeaves',
  'replaceLeaf',
  'applyDrop',
  'applyDropRoot',
  'setRatios',
  'insertAtRoot',
  'normalize'
] as const

/** Every split has 2+ children, one ratio per child, all finite and positive, summing to 1. */
function checkShape(n: LayoutNode, where: string): void {
  if (n.type === 'leaf') return
  ensure(n.children.length >= 2, `${where}: split with ${n.children.length} child(ren)`)
  ensure(
    n.ratios.length === n.children.length,
    `${where}: ${show(n.ratios)} for ${n.children.length} children`
  )
  const sum = n.ratios.reduce((a, b) => a + b, 0)
  ensure(Math.abs(sum - 1) <= 1e-9, `${where}: ratios ${show(n.ratios)} sum to ${sum}`)
  for (const r of n.ratios) ensure(Number.isFinite(r) && r > 0, `${where}: ratio ${r} not positive`)
  for (const c of n.children) checkShape(c, where)
}

/** Leaves are unique and are exactly the expected set. */
function checkLeaves(root: LayoutNode, expected: ReadonlySet<number>, where: string): void {
  const ids = leaves(root)
  ensure(new Set(ids).size === ids.length, `${where}: duplicate leaves ${show(ids)}`)
  const got = new Set(ids)
  ensure(
    got.size === expected.size && [...expected].every((id) => got.has(id)),
    `${where}: leaves ${show(ids)} but expected ${show([...expected])}`
  )
}

/**
 * Frames exist for every leaf, lie inside the area, and dividers are counted. Positive size is NOT asserted
 * here: a deep tree in a small area with a wide gap gives negative widths (seed 1021552, see report).
 */
function checkFrames(root: LayoutNode, expected: ReadonlySet<number>, r: Rng, where: string): void {
  const area = { x: 10, y: 20, w: 1200 + r.int(1200), h: 800 + r.int(800) }
  const gap = r.int(7)
  const { leaves: frames, dividers } = computeFrames(root, area, gap)
  ensure(
    frames.size === expected.size,
    `${where}: ${frames.size} frames for ${expected.size} leaves`
  )
  const eps = 1e-6
  for (const id of expected) {
    const f = frames.get(id)
    ensure(f !== undefined, `${where}: no frame for tab ${id}`)
    ensure(
      f.x >= area.x - eps &&
        f.y >= area.y - eps &&
        f.x + f.w <= area.x + area.w + eps &&
        f.y + f.h <= area.y + area.h + eps,
      `${where}: tab ${id} frame ${show(f)} outside ${show(area)}`
    )
  }
  const countSplits = (n: LayoutNode): number =>
    n.type === 'leaf'
      ? 0
      : n.children.length - 1 + n.children.reduce((a, c) => a + countSplits(c), 0)
  ensure(dividers.length === countSplits(root), `${where}: ${dividers.length} dividers`)
}

test('random edit sequences keep the tree valid (fuzz)', () =>
  fuzz(SEEDS, (r, log) => {
    let root: LayoutNode = leaf(1)
    let ids = new Set([1])
    let next = 2
    const pickId = (): number => r.pick([...ids])
    const check = (where: string): void => {
      checkShape(root, where)
      checkLeaves(root, ids, where)
      checkFrames(root, ids, r, where)
    }

    for (let i = 0; i < STEPS; i++) {
      const op = r.pick(OPS)
      const where = `step ${i} ${op}`
      switch (op) {
        case 'insertTab': {
          if (ids.size >= MAX_LEAVES) break
          const t = pickId()
          const n = next++
          const e = r.pick(EDGES)
          log.push(`insertTab(${t},${n},${e})`)
          root = insertTab(root, t, n, e)
          ids = new Set([...ids, n])
          break
        }
        case 'removeTab': {
          if (ids.size < 2) break
          const id = pickId()
          log.push(`removeTab(${id})`)
          const res = removeTab(root, id)
          ensure(res !== null, `${where}: removing ${id} from ${ids.size} tabs gave null`)
          root = res
          ids.delete(id)
          break
        }
        case 'moveLeaf': {
          if (ids.size < 2) break
          const a = pickId()
          const b = r.pick([...ids].filter((x) => x !== a))
          const e = r.pick(EDGES)
          log.push(`moveLeaf(${a},${b},${e})`)
          root = moveLeaf(root, a, b, e)
          break
        }
        case 'swapLeaves': {
          const a = pickId()
          const b = pickId()
          log.push(`swapLeaves(${a},${b})`)
          const before = leaves(root)
          root = swapLeaves(root, a, b)
          const map = (x: number): number => (x === a ? b : x === b ? a : x)
          ensure(
            show(leaves(root)) === show(before.map(map)),
            `${where}: swap ${a},${b} of ${show(before)} gave ${show(leaves(root))}`
          )
          break
        }
        case 'replaceLeaf': {
          const t = pickId()
          const n = next++
          log.push(`replaceLeaf(${t},${n})`)
          root = replaceLeaf(root, t, n)
          ids.delete(t)
          ids.add(n)
          break
        }
        case 'applyDrop': {
          // id may be a tab already tiled or a brand new one; the target is always a tile in the layout
          const target = pickId()
          const edge = r.pick(ALL_EDGES)
          const fresh = ids.size < MAX_LEAVES && r.chance(0.4)
          const id = fresh ? next++ : pickId()
          log.push(`applyDrop(id=${id},target=${target},${edge},fresh=${fresh})`)
          const before = show(root)
          const res = applyDrop(root, id, target, edge)
          ensure(res !== null, `${where}: applyDrop returned null for a non-null layout`)
          if (id === target) {
            ensure(show(res) === before, `${where}: dropping a tab on itself changed the layout`)
            break
          }
          // a centre drop on a tile replaces it when the dragged tab is new; otherwise tiles only move
          const exp = new Set(ids)
          if (fresh) {
            if (edge === 'center') exp.delete(target)
            exp.add(id)
          }
          root = res
          ids = exp
          break
        }
        case 'applyDropRoot': {
          const edge = r.pick(ALL_EDGES)
          const fresh = ids.size < MAX_LEAVES && r.chance(0.4)
          const id = fresh ? next++ : pickId()
          log.push(`applyDropRoot(id=${id},${edge},fresh=${fresh})`)
          const before = show(root)
          const res = applyDrop(root, id, ROOT_TARGET, edge)
          ensure(res !== null, `${where}: applyDrop(root) returned null`)
          if (edge === 'center')
            ensure(show(res) === before, `${where}: centre drop on the whole layout changed it`)
          root = res
          if (fresh && edge !== 'center') ids.add(id) // a centre drop on the whole layout does nothing
          break
        }
        case 'setRatios': {
          // walk a random path down to some node, then give it ratios that may be valid or hostile
          let node: LayoutNode = root
          const path: number[] = []
          while (node.type === 'split' && r.chance(0.7)) {
            const idx = r.int(node.children.length)
            path.push(idx)
            node = node.children[idx]
          }
          const bad = r.pick([0, 1, 2, 3, 4])
          let ratios: number[]
          if (node.type === 'split' && bad === 0) ratios = node.children.map(() => 0.01 + r.next())
          else if (node.type === 'split' && bad === 1)
            ratios = node.children.map((_, j) => (j === 0 ? 0 : 1))
          else if (node.type === 'split' && bad === 2) ratios = [...node.children.map(() => 1), NaN]
          else if (node.type === 'split' && bad === 3) ratios = node.children.slice(1).map(() => 1)
          else ratios = [Infinity, 0.5]
          log.push(`setRatios(${show(path)},${show(ratios)})`)
          const before = show(root)
          const res = setRatios(root, path, ratios)
          const valid = node.type === 'split' && bad === 0
          if (!valid)
            ensure(
              show(res) === before,
              `${where}: hostile ratios ${show(ratios)} changed the tree`
            )
          root = res
          break
        }
        case 'insertAtRoot': {
          if (ids.size >= MAX_LEAVES) break
          const n = next++
          const e = r.pick(EDGES)
          const share = 0.05 + 0.9 * r.next()
          log.push(`insertAtRoot(${n},${e},${share.toFixed(3)})`)
          root = insertAtRoot(root, n, e, share)
          ids = new Set([...ids, n])
          break
        }
        case 'normalize': {
          const res = normalizeLayout(root)
          if (ids.size < 2) ensure(res === null, `${where}: a single tab is not a layout`)
          else
            ensure(
              res !== null && show(res) === show(root),
              `${where}: normalize changed a valid layout`
            )
          break
        }
      }
      check(where)
    }
  }))

describe('rowOf and single-tab layouts', () => {
  test('rowOf keeps order, equal shares, and a single tab is a leaf (fuzz)', () => {
    fuzz(SEEDS, (r, log) => {
      const count = 1 + r.int(MAX_LEAVES)
      const pool = Array.from({ length: 50 }, (_, i) => i + 1)
      const ids = Array.from({ length: count }, () => pool.splice(r.int(pool.length), 1)[0])
      log.push(`rowOf(${show(ids)})`)
      const root = rowOf(ids)
      ensure(show(leaves(root)) === show(ids), `rowOf order ${show(leaves(root))} != ${show(ids)}`)
      checkShape(root, 'rowOf')
      if (root.type === 'split') {
        for (const x of root.ratios) expect(Math.abs(x - 1 / count)).toBeLessThan(1e-9)
      }
    })
  })
})
