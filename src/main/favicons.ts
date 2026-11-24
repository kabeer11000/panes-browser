import { app } from 'electron'
import { createHash } from 'crypto'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { iconMime, iconAddress } from '@shared/favicon'

/** An icon kept longer than this is still shown, and fetched again behind it (a site that changed its icon). */
const STALE_MS = 7 * 24 * 3600_000
/** No site's icon is bigger than this; anything larger is not an icon. */
const ICON_MAX = 512 * 1024

/**
 * Sites' icons kept on disk, so the sidebar, the board and the palette show them at once after a restart and offline.
 * The window asks for `panes-icon://i/<address>` (default session only: web pages cannot ask, so the folder never
 * tells a page where its person has been). Only icons of pages seen in a normal tab are kept: a private or Tor tab's
 * is fetched each time and never written. ponytail: the folder is not pruned; a few KB a site, prune if it grows.
 */
export class FaviconCache {
  private dir = join(app.getPath('userData'), 'favicons')
  /** Icons of pages seen in a normal tab this run: these may be kept. */
  private keep = new Set<string>()
  private coming = new Map<string, Promise<Uint8Array | null>>()

  constructor(private fetchIcon: (url: string) => Promise<Response>) {}

  /** A normal tab showed this icon: it may be kept on disk. */
  allow(url: string | null): void {
    if (url && /^https?:\/\//i.test(url)) this.keep.add(url)
  }

  private file(url: string): string {
    return join(this.dir, createHash('sha256').update(url).digest('hex').slice(0, 40))
  }

  /** The icon's bytes from the site (once at a time per address); written to disk when it may be kept. */
  private fetchOnce(url: string): Promise<Uint8Array | null> {
    const had = this.coming.get(url)
    if (had) return had
    const go = (async (): Promise<Uint8Array | null> => {
      try {
        const res = await this.fetchIcon(url)
        if (!res.ok) return null
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (bytes.byteLength === 0 || bytes.byteLength > ICON_MAX || !iconMime(bytes)) return null
        if (this.keep.has(url)) {
          await mkdir(this.dir, { recursive: true })
          await writeFile(this.file(url), bytes)
        }
        return bytes
      } catch {
        return null
      }
    })().finally(() => this.coming.delete(url))
    this.coming.set(url, go)
    return go
  }

  /** The response to a `panes-icon://` request: from disk when there, else from the site. */
  async serve(requestUrl: string): Promise<Response> {
    const url = iconAddress(requestUrl)
    if (!url) return new Response(null, { status: 404 })
    const path = this.file(url)
    const st = await stat(path).catch(() => null)
    let bytes: Uint8Array | null = null
    if (st) {
      bytes = new Uint8Array(await readFile(path).catch(() => new Uint8Array()))
      if (Date.now() - st.mtimeMs > STALE_MS) void this.fetchOnce(url)
    }
    if (!bytes?.byteLength) bytes = await this.fetchOnce(url)
    const mime = bytes && iconMime(bytes)
    if (!bytes || !mime) return new Response(null, { status: 404 })
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: { 'content-type': mime, 'cache-control': 'private, max-age=86400' }
    })
  }
}
