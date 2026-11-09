import { dot } from './cluster'

export const INDEX_CAP = 20000

export interface VectorMeta {
  key: string
  /** Hash of the text the vector was made from, so unchanged pages are not embedded again. */
  hash: string
  /** Last time the page was visited (ms), for evicting the least recently visited first. */
  visited: number
  title: string
}

interface Entry extends VectorMeta {
  vec: Float32Array
}

const unit = (v: ArrayLike<number>): Float32Array => {
  const out = Float32Array.from(v)
  let n = 0
  for (const x of out) n += x * x
  n = Math.sqrt(n)
  if (n > 0) for (let i = 0; i < out.length; i++) out[i] /= n
  return out
}

export interface SerializedIndex {
  meta: string
  bin: Uint8Array
}

/**
 * Vectors by key, kept unit length so a dot product is the cosine. Search is brute force.
 * ponytail: brute-force cosine over <=20k vectors; move to int8 or an ANN index if search exceeds ~20 ms
 */
export class VectorIndex {
  private entries = new Map<string, Entry>()

  constructor(
    readonly dim: number,
    readonly cap = INDEX_CAP,
    /** What made these vectors (provider and model): vectors of another kind cannot be compared. */
    readonly signature = ''
  ) {}

  get size(): number {
    return this.entries.size
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  hashOf(key: string): string | undefined {
    return this.entries.get(key)?.hash
  }

  /** The unit vector stored for a key. */
  vectorOf(key: string): Float32Array | undefined {
    return this.entries.get(key)?.vec
  }

  /** Add or replace. Over the cap, the least recently visited entries go. Returns the keys evicted. */
  add(meta: VectorMeta, vec: ArrayLike<number>): string[] {
    if (vec.length !== this.dim)
      throw new Error(`expected ${this.dim} dimensions, got ${vec.length}`)
    this.entries.delete(meta.key) // re-insert at the end
    this.entries.set(meta.key, { ...meta, vec: unit(vec) })
    const evicted: string[] = []
    while (this.entries.size > this.cap) {
      let oldest: Entry | null = null
      for (const e of this.entries.values()) if (!oldest || e.visited < oldest.visited) oldest = e
      if (!oldest) break
      this.entries.delete(oldest.key)
      evicted.push(oldest.key)
    }
    return evicted
  }

  touch(key: string, visited: number): void {
    const e = this.entries.get(key)
    if (e) e.visited = Math.max(e.visited, visited)
  }

  remove(key: string): boolean {
    return this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  keys(): string[] {
    return [...this.entries.keys()]
  }

  /** The closest entries to `query`, best first, none scoring below `min`. */
  topK(query: ArrayLike<number>, k: number, min = -1): Array<VectorMeta & { score: number }> {
    if (query.length !== this.dim) return []
    const q = unit(query)
    const out: Array<VectorMeta & { score: number }> = []
    for (const e of this.entries.values()) {
      const score = dot(q, e.vec)
      if (score >= min)
        out.push({ key: e.key, hash: e.hash, visited: e.visited, title: e.title, score })
    }
    return out.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1)).slice(0, k)
  }

  /** The vectors as two blobs: JSON for who and what, raw Float32 for the numbers (same order). */
  serialize(): SerializedIndex {
    const list = [...this.entries.values()]
    const bin = new Float32Array(list.length * this.dim)
    list.forEach((e, i) => bin.set(e.vec, i * this.dim))
    const meta = JSON.stringify({
      dim: this.dim,
      signature: this.signature,
      items: list.map((e) => ({ key: e.key, hash: e.hash, visited: e.visited, title: e.title }))
    })
    return { meta, bin: new Uint8Array(bin.buffer) }
  }

  /** Null when the blobs do not belong together (a half-written file, say). */
  static deserialize(meta: string, bin: Uint8Array, cap = INDEX_CAP): VectorIndex | null {
    try {
      const m = JSON.parse(meta) as { dim: number; signature: string; items: VectorMeta[] }
      if (!Number.isInteger(m.dim) || m.dim <= 0 || !Array.isArray(m.items)) return null
      if (bin.byteLength !== m.items.length * m.dim * 4) return null
      const floats = new Float32Array(
        bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)
      )
      const index = new VectorIndex(m.dim, cap, m.signature)
      m.items.forEach((item, i) => {
        index.entries.set(item.key, {
          key: item.key,
          hash: item.hash,
          visited: item.visited,
          title: item.title,
          vec: floats.slice(i * m.dim, (i + 1) * m.dim)
        })
      })
      return index
    } catch {
      return null
    }
  }
}
