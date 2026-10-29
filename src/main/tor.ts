import { app, net } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { basename, join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import {
  buildTorrc,
  parseBootstrap,
  snowflakeBridges,
  torBundleFor,
  type TorStatus
} from '../shared/tor'

const exe = process.platform === 'win32' ? '.exe' : ''

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => resolve(port))
    })
  })

const run = (cmd: string, args: string[], cwd: string): Promise<void> =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { windowsHide: true, cwd }, (err) => (err ? reject(err) : resolve()))
  )

/** Windows ships its own tar; a GNU tar earlier on PATH would read "C:" in a path as a remote host. */
const tarCommand = (): string =>
  process.platform === 'win32'
    ? join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32', 'tar.exe')
    : 'tar'

/**
 * Runs Tor for private-with-Tor tabs. The daemon is not shipped in the installer: on first use the pinned
 * expert bundle is downloaded from the Tor Project, checked against its SHA-256 and unpacked under the
 * user's data folder. Tor only listens on 127.0.0.1, and only while it is wanted.
 */
export class TorManager {
  private proc: ChildProcess | null = null
  private listeners = new Set<(s: TorStatus) => void>()
  private port = 0
  private starting: Promise<void> | null = null
  private status: TorStatus = {
    state: 'off',
    progress: 0,
    message: '',
    snowflake: false,
    usage: { up: 0, down: 0 },
    supported: torBundleFor(process.platform, process.arch) !== null
  }

  private get root(): string {
    return join(app.getPath('userData'), 'tor')
  }

  get socksPort(): number {
    return this.port
  }

  get(): TorStatus {
    return this.status
  }

  onChange(cb: (s: TorStatus) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private set(patch: Partial<TorStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const cb of this.listeners) cb(this.status)
  }

  /** Download if needed, then start Tor (with Snowflake bridges when asked); resolves once it is usable. */
  start(snowflake: boolean): Promise<void> {
    if (this.status.state === 'ready' && this.status.snowflake === snowflake)
      return Promise.resolve()
    if (this.starting) return this.starting
    this.starting = this.launch(snowflake)
      .catch((err: unknown) => {
        this.stopProcess()
        this.set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      })
      .finally(() => {
        this.starting = null
      })
    return this.starting
  }

  stop(): void {
    this.stopProcess()
    this.set({ state: 'off', progress: 0, message: '' })
  }

  private stopProcess(): void {
    const p = this.proc
    this.proc = null
    if (p && !p.killed) p.kill()
  }

  private async launch(snowflake: boolean): Promise<void> {
    const bundle = torBundleFor(process.platform, process.arch)
    if (!bundle) throw new Error('Tor is not available for this system yet')
    this.stopProcess()
    this.set({ state: 'downloading', progress: 0, message: 'Getting Tor', snowflake })

    const dir = join(this.root, bundle.version)
    const torBin = join(dir, 'tor', `tor${exe}`)
    if (!existsSync(torBin)) await this.download(bundle.url, bundle.sha256, dir)

    this.set({ state: 'starting', progress: 0, message: 'Connecting to Tor' })
    const ptDir = join(dir, 'tor', 'pluggable_transports')
    const bridges = snowflake
      ? snowflakeBridges(JSON.parse(readFileSync(join(ptDir, 'pt_config.json'), 'utf8')))
      : []
    if (snowflake && bridges.length === 0) throw new Error('No Snowflake bridges in this Tor build')

    this.port = await freePort()
    const dataDir = join(this.root, 'data')
    mkdirSync(dataDir, { recursive: true })
    const torrc = join(this.root, 'torrc')
    writeFileSync(
      torrc,
      buildTorrc({
        socksPort: this.port,
        dataDir,
        geoip: join(dir, 'data', 'geoip'),
        geoip6: join(dir, 'data', 'geoip6'),
        snowflake: snowflake ? { exec: join(ptDir, `snowflake-client${exe}`), bridges } : undefined
      })
    )

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(torBin, ['-f', torrc], { cwd: join(dir, 'tor'), windowsHide: true })
      this.proc = proc
      let buffer = ''
      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const pct = parseBootstrap(line)
          if (pct === null) continue
          this.set({
            progress: pct,
            message: pct >= 100 ? 'Connected' : `Connecting to Tor, ${pct}%`
          })
          if (pct >= 100) {
            this.set({ state: 'ready' })
            resolve()
          }
        }
      })
      proc.once('error', reject)
      proc.once('exit', (code) => {
        if (this.proc === proc) {
          this.proc = null
          this.set({ state: code === 0 ? 'off' : 'error', message: `Tor stopped (${code})` })
        }
        reject(new Error(`Tor stopped (${code})`))
      })
    })
  }

  /** Fetch the bundle, refuse anything that does not match the pinned checksum, unpack it. */
  private async download(url: string, sha256: string, dir: string): Promise<void> {
    mkdirSync(this.root, { recursive: true })
    const archive = join(this.root, 'bundle.tar.gz')
    const res = await net.fetch(url)
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
    const total = Number(res.headers.get('content-length')) || 0
    const hash = createHash('sha256')
    let got = 0
    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    body.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      got += chunk.length
      if (total > 0) this.set({ progress: Math.round((got / total) * 100) })
    })
    await pipeline(body, createWriteStream(archive))
    if (hash.digest('hex') !== sha256) {
      rmSync(archive, { force: true })
      throw new Error('The downloaded Tor bundle did not match its checksum, so it was discarded')
    }
    this.set({ message: 'Unpacking Tor' })
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    // relative to the folder both live in, so no drive letter is ever on the command line
    await run(tarCommand(), ['-xzf', 'bundle.tar.gz', '-C', basename(dir)], this.root)
    rmSync(archive, { force: true })
  }
}
