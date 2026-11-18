/**
 * A least-recently-used map with a budget: each entry has a weight (1 by default), and the oldest entries go once the
 * total is over `budget` (the newest always stays, whatever it weighs). `onEvict` hears each one that goes.
 */
export class Lru<K, V> {
  private map = new Map<K, { v: V; w: number }>()
  private total = 0

  constructor(
    private readonly budget: number,
    private readonly onEvict?: (k: K, v: V) => void
  ) {}

  get size(): number {
    return this.map.size
  }

  get weight(): number {
    return this.total
  }

  has(k: K): boolean {
    return this.map.has(k)
  }

  /** The value without making it the newest (for render: reading must not change anything). */
  peek(k: K): V | undefined {
    return this.map.get(k)?.v
  }

  /** The value, made the newest. */
  get(k: K): V | undefined {
    const e = this.map.get(k)
    if (!e) return undefined
    this.map.delete(k)
    this.map.set(k, e)
    return e.v
  }

  set(k: K, v: V, w = 1): void {
    const was = this.map.get(k)
    if (was) {
      this.map.delete(k)
      this.total -= was.w
      if (was.v !== v) this.onEvict?.(k, was.v)
    }
    this.map.set(k, { v, w })
    this.total += w
    for (const [ok, oe] of this.map) {
      if (this.total <= this.budget || ok === k) break
      this.map.delete(ok)
      this.total -= oe.w
      this.onEvict?.(ok, oe.v)
    }
  }

  delete(k: K): void {
    const e = this.map.get(k)
    if (!e) return
    this.map.delete(k)
    this.total -= e.w
    this.onEvict?.(k, e.v)
  }
}
