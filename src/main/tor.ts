import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { gunzipSync } from 'zlib'
import { readTar } from '@shared/untar'
import {
  buildTorrc,
  parseBootstrap,
  snowflakeBridges,
  snowflakeProgram,
  torBundleFor,
  type TorStatus
} from '@shared/tor'
import { exe, fetchVerified, freePort, run, tarCommand } from './fetchVerified'

/** How long Tor gets to connect before Panes gives up and says what to try. */
const CONNECT_MS = 120_000

/** Unpack a .tar.gz into `dir` with no system tar (paths that would leave `dir` are refused, see readTar). */
function unpackTarGz(archive: string, dir: string): void {
  for (const e of readTar(gunzipSync(readFileSync(archive)))) {
    const to = join(dir, ...e.path.split('/'))
    if (e.type === 'dir') mkdirSync(to, { recursive: true })
    else {
      mkdirSync(dirname(to), { recursive: true })
      writeFileSync(to, e.data, { mode: e.mode })
    }
  }
}

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
        // a failure that already said what to do (no connection in time) keeps its words
        if (this.status.state !== 'error')
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
    if (!existsSync(torBin)) await this.download(bundle.urls, bundle.sha256, dir, torBin)

    this.set({ state: 'starting', progress: 0, message: 'Connecting to Tor' })
    const ptDir = join(dir, 'tor', 'pluggable_transports')
    const ptConfig: unknown = snowflake
      ? JSON.parse(readFileSync(join(ptDir, 'pt_config.json'), 'utf8'))
      : null
    const bridges = snowflake ? snowflakeBridges(ptConfig) : []
    if (snowflake && bridges.length === 0) throw new Error('No Snowflake bridges in this Tor build')
    // the program the bundle says runs Snowflake (lyrebird in current builds); the old name for older bundles
    const legacy = `snowflake-client${exe}`
    const named = snowflake ? snowflakeProgram(ptConfig) : null
    const program = named && existsSync(join(ptDir, named)) ? named : legacy
    if (snowflake && !existsSync(join(ptDir, program)))
      throw new Error('This Tor build has no Snowflake program')
    // relative to Tor's folder (its working directory): no spaces from the user's folder can reach the exec line
    const ptExec = join('pluggable_transports', program)

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
        snowflake: snowflake ? { exec: ptExec, bridges } : undefined
      })
    )

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(torBin, ['-f', torrc], { cwd: join(dir, 'tor'), windowsHide: true })
      this.proc = proc
      let buffer = ''
      // what Tor said last, for a failure that says why (not just "Tor stopped (1)")
      let lastLine = ''
      let settled = false
      // a network that blocks Tor leaves it short of 100% for good: give up and say what to try
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.stopProcess()
        this.set({
          state: 'error',
          message: snowflake
            ? 'Tor could not connect. Check your connection and try again.'
            : 'Tor could not connect. If Tor is blocked where you are, turn on Snowflake in settings and try again.'
        })
        reject(new Error('Tor did not connect in time'))
      }, CONNECT_MS)
      const said = (chunk: Buffer): void => {
        const t = chunk.toString().trim().split(/\r?\n/).pop()
        if (t) lastLine = t.replace(/^.*\[(notice|warn|err)\]\s*/i, '').slice(0, 200)
      }
      proc.stderr.on('data', said)
      proc.stdout.on('data', (chunk: Buffer) => {
        said(chunk)
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
          if (pct >= 100 && !settled) {
            settled = true
            clearTimeout(timer)
            this.set({ state: 'ready' })
            resolve()
          }
        }
      })
      proc.once('error', (err) => {
        settled = true
        clearTimeout(timer)
        reject(err)
      })
      proc.once('exit', (code) => {
        clearTimeout(timer)
        const why = lastLine ? `Tor stopped: ${lastLine}` : `Tor stopped (${code})`
        if (this.proc === proc) {
          this.proc = null
          this.set({ state: code === 0 ? 'off' : 'error', message: why })
        }
        if (!settled) {
          settled = true
          reject(new Error(why))
        }
      })
    })
  }

  /**
   * Fetch the bundle (from the first address that has it), refuse anything that does not match the pinned checksum,
   * unpack it. The system's tar does the unpacking where there is one; it can report an error for a detail (a file
   * time it could not set) after unpacking everything, so what counts is whether Tor is there after. Without a usable
   * tar (early Windows 10 has none) Panes unpacks it itself.
   */
  private async download(
    urls: string[],
    sha256: string,
    dir: string,
    torBin: string
  ): Promise<void> {
    mkdirSync(this.root, { recursive: true })
    const archive = join(this.root, 'bundle.tar.gz')
    let lastErr: unknown = null
    for (const url of urls) {
      try {
        await fetchVerified({
          url,
          sha256,
          dest: archive,
          label: 'Tor bundle',
          onProgress: (got, total) => {
            if (total > 0) this.set({ progress: Math.round((got / total) * 100) })
          }
        })
        lastErr = null
        break
      } catch (err) {
        lastErr = err // a checksum that does not match is not tried elsewhere: the next address may have it right
      }
    }
    if (lastErr) throw lastErr instanceof Error ? lastErr : new Error('Could not download Tor')
    this.set({ message: 'Unpacking Tor' })
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    try {
      // relative to the folder both live in, so no drive letter is ever on the command line; -m: no file times
      await run(tarCommand(), ['-xzmf', 'bundle.tar.gz', '-C', basename(dir)], this.root)
    } catch {
      if (!existsSync(torBin)) unpackTarGz(archive, dir)
    }
    if (!existsSync(torBin)) unpackTarGz(archive, dir)
    rmSync(archive, { force: true })
    if (!existsSync(torBin)) throw new Error('Tor could not be unpacked')
  }
}
