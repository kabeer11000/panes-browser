import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { gemmaDocument, gemmaQuery, normalizeUrl } from '@shared/ai/urls'
import { INDEX_CAP, VectorIndex, type VectorMeta } from '@shared/ai/vectors'
import type { AiContext } from '@shared/ai/types'
import type { AiRouter } from './router'
import { aiRoot } from './runtime'

const BATCH = 32
const SUB_BATCH = 8
const SAVE_MS = 8000
const NORMAL: AiContext = { private: false, tor: false }

export interface IndexHit {
  url: string
  title: string
  score: number
}

export interface PageDoc {
  url: string
  title: string
  /** Title, description and the start of the text, as made by documentText. */
  text: string
  visited: number
}

const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex')

/**
 * What the person's pages mean, as vectors: one per normalized URL, from open tabs and history. Kept in memory
 * once loaded (loading waits for the first use) and saved as index.bin (Float32) beside index.json under the AI
 * folder. Everything goes through the router, so nothing from a private or Tor tab can ever get in.
 */
export class EmbeddingIndex {
  private ix: VectorIndex | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private queryCache = new Map<string, number[]>()
  private backfilling = false

  constructor(
    private router: AiRouter,
    /** Whether the embedding model is EmbeddingGemma, which wants its task prefixes. */
    private usesGemma: () => boolean
  ) {}

  private get binFile(): string {
    return join(aiRoot(), 'index.bin')
  }
  private get metaFile(): string {
    return join(aiRoot(), 'index.json')
  }

  private load(): VectorIndex | null {
    if (this.ix) return this.ix
    try {
      const meta = readFileSync(this.metaFile, 'utf8')
      const bin = readFileSync(this.binFile)
      this.ix = VectorIndex.deserialize(meta, bin, INDEX_CAP)
    } catch {
      this.ix = null
    }
    return this.ix
  }

  get size(): number {
    return this.load()?.size ?? 0
  }

  private save(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => this.flush(), SAVE_MS)
    this.saveTimer.unref()
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.ix) return
    try {
      mkdirSync(aiRoot(), { recursive: true })
      const { meta, bin } = this.ix.serialize()
      writeFileSync(`${this.binFile}.tmp`, bin)
      renameSync(`${this.binFile}.tmp`, this.binFile)
      writeFileSync(`${this.metaFile}.tmp`, meta)
      renameSync(`${this.metaFile}.tmp`, this.metaFile)
    } catch (err) {
      console.error('[ai] saving the index failed:', err)
    }
  }

  /** Forget everything, in memory and on disk (AI turned off, or its data removed). */
  clear(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.ix = null
    this.queryCache.clear()
    for (const f of [this.binFile, this.metaFile]) rmSync(f, { force: true })
  }

  /** Vectors for the pages (null where the model could not be reached). Opens or resets the index to match. */
  private async embedDocs(docs: PageDoc[], priority: 'high' | 'low'): Promise<number[][] | null> {
    const gemma = this.usesGemma()
    const texts = docs.map((d) => (gemma ? gemmaDocument(d.title, d.text) : d.text))
    // background work goes in small calls, so a query typed meanwhile waits for one of them, not the whole batch
    const step = priority === 'low' ? SUB_BATCH : texts.length
    const vectors: number[][] = []
    let signature = ''
    for (let i = 0; i < texts.length; i += step) {
      const res = await this.router.embed(texts.slice(i, i + step), NORMAL, { priority })
      if (!res) return null
      vectors.push(...res.vectors)
      signature = res.signature
    }
    if (vectors.length !== docs.length || vectors.length === 0) return null
    const res = { vectors, signature }
    const dim = res.vectors[0].length
    let ix = this.load()
    // vectors from another model (or another size) cannot be compared with these: start over
    if (!ix || ix.dim !== dim || ix.signature !== res.signature) {
      ix = new VectorIndex(dim, INDEX_CAP, res.signature)
      this.ix = ix
    }
    return res.vectors
  }

  /** Add or refresh pages. Unchanged ones (same text) are only marked as visited again. */
  async upsert(docs: PageDoc[], priority: 'high' | 'low' = 'low'): Promise<void> {
    const todo: Array<PageDoc & { key: string; hash: string }> = []
    const ix = this.load()
    for (const d of docs) {
      const key = normalizeUrl(d.url)
      if (!key || !d.text.trim()) continue
      const hash = sha1(d.text)
      if (ix?.hashOf(key) === hash) ix.touch(key, d.visited)
      else todo.push({ ...d, key, hash })
    }
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH)
      const vectors = await this.embedDocs(batch, priority)
      if (!vectors || !this.ix) return
      batch.forEach((d, n) => {
        const meta: VectorMeta = { key: d.key, hash: d.hash, visited: d.visited, title: d.title }
        this.ix?.add(meta, vectors[n])
      })
      this.save()
    }
  }

  has(url: string): boolean {
    const key = normalizeUrl(url)
    return !!key && !!this.load()?.has(key)
  }

  vectorOf(url: string): Float32Array | undefined {
    const key = normalizeUrl(url)
    return key ? this.load()?.vectorOf(key) : undefined
  }

  remove(urls: string[]): void {
    const ix = this.load()
    if (!ix) return
    let changed = false
    for (const u of urls) {
      const key = normalizeUrl(u)
      if (key && ix.remove(key)) changed = true
    }
    if (changed) this.save()
  }

  /** Pages closest in meaning to the query, best first. Null when the model could not answer in time. */
  async search(
    query: string,
    k: number,
    min: number,
    exclude: Set<string>,
    timeoutMs: number
  ): Promise<IndexHit[] | null> {
    const ix = this.load()
    if (!ix || ix.size === 0) return []
    const q = query.trim().toLowerCase()
    let vec = this.queryCache.get(q)
    if (!vec) {
      const text = this.usesGemma() ? gemmaQuery(query.trim()) : query.trim()
      const res = await this.router.embed([text], NORMAL, { priority: 'high', timeoutMs })
      vec = res?.vectors[0]
      if (!vec || res?.signature !== ix.signature) return null
      if (this.queryCache.size >= 50) {
        this.queryCache.delete(this.queryCache.keys().next().value as string)
      }
      this.queryCache.set(q, vec)
    }
    const skip = new Set([...exclude].map((u) => normalizeUrl(u)))
    return ix
      .topK(vec, k + skip.size, min)
      .filter((h) => !skip.has(h.key))
      .slice(0, k)
      .map((h) => ({ url: h.key, title: h.title, score: h.score }))
  }

  /** Index what is in history by title and address, in batches, in the background and without hurrying. */
  async backfill(
    entries: ReadonlyArray<{ url: string; title: string; time: number }>
  ): Promise<void> {
    if (this.backfilling) return
    this.backfilling = true
    try {
      const seen = new Set<string>()
      let batch: PageDoc[] = []
      for (const e of entries) {
        const key = normalizeUrl(e.url)
        if (!key || seen.has(key) || this.load()?.has(key)) continue
        seen.add(key)
        batch.push({ url: e.url, title: e.title, text: `${e.title}\n${e.url}`, visited: e.time })
        if (batch.length < BATCH) continue
        const before = this.ix?.size ?? 0
        await this.upsert(batch, 'low')
        if ((this.ix?.size ?? 0) === before) return // nothing could be embedded: stop rather than spin
        batch = []
      }
      if (batch.length > 0) await this.upsert(batch, 'low')
    } finally {
      this.backfilling = false
    }
  }

  /** The index has been saved at least once. */
  get saved(): boolean {
    return existsSync(this.metaFile)
  }
}
