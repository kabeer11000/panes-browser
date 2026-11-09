import { net } from 'electron'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, renameSync, rmSync } from 'fs'
import { createServer } from 'net'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

export const exe = process.platform === 'win32' ? '.exe' : ''

export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => resolve(port))
    })
  })

export const run = (cmd: string, args: string[], cwd: string): Promise<void> =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { windowsHide: true, cwd }, (err) => (err ? reject(err) : resolve()))
  )

/** Windows ships its own tar; a GNU tar earlier on PATH would read "C:" in a path as a remote host. */
export const tarCommand = (): string =>
  process.platform === 'win32'
    ? join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32', 'tar.exe')
    : 'tar'

export interface FetchOptions {
  url: string
  /** Lower-case hex SHA-256 the bytes must have. */
  sha256: string
  /** Where the verified file ends up. */
  dest: string
  /** Called as bytes arrive: how many so far, and how many in all (0 when the server does not say). */
  onProgress?: (received: number, total: number) => void
  signal?: AbortSignal
  /** What the person is told when the bytes do not match, e.g. "the Tor bundle". */
  label: string
}

/**
 * Download a file to `dest` through Chromium's network stack (proxies, system certificates), hashing as it goes.
 * The bytes go to a temporary file first; only a file that matches `sha256` is moved into place, anything else
 * is deleted.
 */
export async function fetchVerified(o: FetchOptions): Promise<void> {
  const part = `${o.dest}.part`
  try {
    const res = await net.fetch(o.url, { signal: o.signal })
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
    const total = Number(res.headers.get('content-length')) || 0
    const hash = createHash('sha256')
    let got = 0
    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    body.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      got += chunk.length
      o.onProgress?.(got, total)
    })
    await pipeline(body, createWriteStream(part))
    if (hash.digest('hex') !== o.sha256) {
      throw new Error(`The downloaded ${o.label} did not match its checksum, so it was discarded`)
    }
    renameSync(part, o.dest)
  } finally {
    rmSync(part, { force: true })
  }
}
