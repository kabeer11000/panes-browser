import { describe, expect, test } from 'bun:test'
import { VectorIndex, type VectorMeta } from './vectors'

const meta = (key: string, visited = 1): VectorMeta => ({
  key,
  hash: `h-${key}`,
  visited,
  title: key
})

describe('VectorIndex', () => {
  test('topK orders by similarity and honours the floor', () => {
    const ix = new VectorIndex(2)
    ix.add(meta('x'), [1, 0])
    ix.add(meta('xy'), [1, 1])
    ix.add(meta('y'), [0, 1])
    expect(ix.topK([1, 0], 3).map((r) => r.key)).toEqual(['x', 'xy', 'y'])
    expect(ix.topK([1, 0], 3, 0.5).map((r) => r.key)).toEqual(['x', 'xy'])
    expect(ix.topK([1, 0], 1)[0].score).toBeCloseTo(1)
  })

  test('vectorOf gives the stored unit vector', () => {
    const ix = new VectorIndex(2)
    ix.add(meta('a'), [3, 4])
    const v = ix.vectorOf('a') as Float32Array
    expect(v[0]).toBeCloseTo(0.6)
    expect(v[1]).toBeCloseTo(0.8)
    expect(ix.vectorOf('b')).toBeUndefined()
  })

  test('remove', () => {
    const ix = new VectorIndex(2)
    ix.add(meta('a'), [1, 0])
    expect(ix.remove('a')).toBe(true)
    expect(ix.remove('a')).toBe(false)
    expect(ix.topK([1, 0], 3)).toEqual([])
  })

  test('adding a key again replaces it', () => {
    const ix = new VectorIndex(2)
    ix.add(meta('a'), [1, 0])
    ix.add({ ...meta('a'), hash: 'new' }, [0, 1])
    expect(ix.size).toBe(1)
    expect(ix.hashOf('a')).toBe('new')
  })

  test('evicts the least recently visited over the cap', () => {
    const ix = new VectorIndex(2, 2)
    ix.add(meta('old', 1), [1, 0])
    ix.add(meta('new', 9), [1, 0])
    expect(ix.add(meta('mid', 5), [1, 0])).toEqual(['old'])
    expect(ix.keys().sort()).toEqual(['mid', 'new'])
  })

  test('touch protects an entry from eviction', () => {
    const ix = new VectorIndex(2, 2)
    ix.add(meta('a', 1), [1, 0])
    ix.add(meta('b', 2), [1, 0])
    ix.touch('a', 10)
    expect(ix.add(meta('c', 3), [1, 0])).toEqual(['b'])
  })

  test('a vector of the wrong size is refused', () => {
    expect(() => new VectorIndex(2).add(meta('a'), [1, 0, 0])).toThrow()
    expect(new VectorIndex(2).topK([1, 0, 0], 1)).toEqual([])
  })

  test('serialize round trip', () => {
    const ix = new VectorIndex(3, 100, 'sig')
    ix.add(meta('a', 5), [1, 2, 3])
    ix.add(meta('b', 6), [-1, 0, 4])
    const { meta: m, bin } = ix.serialize()
    const back = VectorIndex.deserialize(m, bin) as VectorIndex
    expect(back.signature).toBe('sig')
    expect(back.dim).toBe(3)
    expect(back.keys()).toEqual(['a', 'b'])
    expect(back.topK([1, 2, 3], 2).map((r) => r.key)).toEqual(['a', 'b'])
    expect(back.topK([1, 2, 3], 1)[0].score).toBeCloseTo(1)
    expect(back.hashOf('b')).toBe('h-b')
  })

  test('mismatched or broken blobs give null', () => {
    const ix = new VectorIndex(2)
    ix.add(meta('a'), [1, 0])
    const { meta: m, bin } = ix.serialize()
    expect(VectorIndex.deserialize(m, bin.slice(0, 4))).toBeNull()
    expect(VectorIndex.deserialize('{oops', bin)).toBeNull()
    expect(VectorIndex.deserialize('{"dim":0,"items":[]}', new Uint8Array())).toBeNull()
  })
})
