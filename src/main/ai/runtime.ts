import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync
} from 'fs'
import { copyFile, rename, rm } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import {
  MODELS,
  RUNTIME_BUILDS,
  runtimeBuildsFor,
  type ModelRole,
  type ModelSpec,
  type RuntimeBuild
} from '@shared/ai/models'
import { serverArgs } from '@shared/ai/server'
import type { AiStatus, ServerStatus } from '@shared/ai/types'
import { exe, fetchVerified, freePort, run, tarCommand } from '../fetchVerified'

const ROLES: ModelRole[] = ['embed', 'chat']
const GPU_HEALTH_MS = 15_000
const CPU_HEALTH_MS = 120_000
// both servers give their RAM back when unused; the omnibox warms the embedder again on focus
const IDLE_MS: Record<ModelRole, number> = { chat: 5 * 60_000, embed: 15 * 60_000 }
const CRASH_WINDOW_MS = 10 * 60_000
const CRASH_LIMIT = 3
const NOTIFY_MS = 200

export interface Endpoint {
  baseURL: string
  apiKey: string
}

interface Server {
  proc: ChildProcess | null
  port: number
  key: string
  state: ServerStatus['state']
  message: string
  starting: Promise<Endpoint> | null
  idle: NodeJS.Timeout | null
  crashes: number[]
  /** Set while Panes itself is stopping the process, so its exit is not counted as a crash. */
  stopping: boolean
}

const newServer = (): Server => ({
  proc: null,
  port: 0,
  key: '',
  state: 'off',
  message: '',
  starting: null,
  idle: null,
  crashes: [],
  stopping: false
})

export const aiRoot = (): string => join(app.getPath('userData'), 'ai')
export const defaultModelsDir = (): string => join(aiRoot(), 'models')

const samePath = (a: string, b: string): boolean => {
  const norm = (p: string): string => {
    const r = resolve(p)
    return process.platform === 'linux' ? r : r.toLowerCase()
  }
  return norm(a) === norm(b)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The first file called `name` under `dir` (an archive unpacks into a folder of its own, or not). */
function findFile(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return p
    if (entry.isDirectory()) {
      const hit = findFile(p, name)
      if (hit) return hit
    }
  }
  return null
}

export function dirSize(dir: string): number {
  let total = 0
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      total += e.isDirectory() ? dirSize(p) : statSync(p).size
    }
  } catch {
    // a folder that is not there takes no room
  }
  return total
}

const lastLine = (tail: string): string => tail.trim().split(/\r?\n/).pop() ?? ''

interface Step {
  size: number
  run: (progress: (bytes: number) => void) => Promise<void>
}

/**
 * Panes' own llama.cpp: downloads the pinned runtime and models into the data folder on demand, and runs two
 * llama-server processes (embeddings, and chat for short prompts) bound to the loopback address with a fresh
 * random key each launch. Nothing here is bundled with the app.
 */
export class LocalRuntime {
  private servers: Record<ModelRole, Server> = { embed: newServer(), chat: newServer() }
  private listeners = new Set<() => void>()
  private notifyTimer: NodeJS.Timeout | null = null
  private enabled = false
  private local = true
  private download: { received: number; total: number } | null = null
  private downloading: Promise<void> | null = null
  private abort: AbortController | null = null
  private error: string | null = null
  private blocked = false
  private accel: 'gpu' | 'cpu' | null = null
  private warned = new Set<string>()
  private moving = false

  /** `customDir` is the models folder the user picked (null: the one in the data folder). */
  constructor(private customDir: () => string | null = () => null) {}

  private get runtimeDir(): string {
    return join(aiRoot(), 'runtime')
  }
  get modelsDir(): string {
    return this.customDir() || defaultModelsDir()
  }
  private get stateFile(): string {
    return join(aiRoot(), 'state.json')
  }

  get supported(): boolean {
    return runtimeBuildsFor(process.platform, process.arch).length > 0
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private changed(now = false): void {
    if (now) {
      if (this.notifyTimer) clearTimeout(this.notifyTimer)
      this.notifyTimer = null
      for (const cb of this.listeners) cb()
    } else if (!this.notifyTimer) {
      this.notifyTimer = setTimeout(() => this.changed(true), NOTIFY_MS)
    }
  }

  private warnOnce(key: string, detail: unknown): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    console.warn(`[ai] ${key}:`, detail instanceof Error ? detail.message : detail)
  }

  // ---- what is on disk ----

  private cpuOnly(): boolean {
    try {
      const state = JSON.parse(readFileSync(this.stateFile, 'utf8')) as { cpuOnly?: boolean }
      return state.cpuOnly === true
    } catch {
      return false
    }
  }

  private setCpuOnly(on: boolean): void {
    try {
      mkdirSync(aiRoot(), { recursive: true })
      writeFileSync(this.stateFile, JSON.stringify({ cpuOnly: on }))
    } catch (err) {
      this.warnOnce('state', err)
    }
  }

  /** The build to run: the best one for this system, or the CPU one after the GPU one failed to start. */
  private build(): RuntimeBuild | null {
    const all = runtimeBuildsFor(process.platform, process.arch)
    return (this.cpuOnly() ? all.find((b) => !b.gpu) : undefined) ?? all[0] ?? null
  }

  private buildDir(b: RuntimeBuild): string {
    return join(this.runtimeDir, b.id)
  }

  private buildReady(b: RuntimeBuild): boolean {
    return existsSync(join(this.buildDir(b), '.ok'))
  }

  private binary(b: RuntimeBuild): string | null {
    const dir = this.buildDir(b)
    return existsSync(dir) ? findFile(dir, `llama-server${exe}`) : null
  }

  private modelPath(m: ModelSpec): string {
    return join(this.modelsDir, m.file)
  }

  private modelReady(m: ModelSpec): boolean {
    try {
      return statSync(this.modelPath(m)).size === m.size // the bytes were hashed when they arrived
    } catch {
      return false
    }
  }

  get installed(): boolean {
    const b = this.build()
    return !!b && this.buildReady(b) && ROLES.every((r) => this.modelReady(MODELS[r]))
  }

  /** What a full local setup weighs, for the card (runtime and both models). */
  private fullSize(): number {
    const b = runtimeBuildsFor(process.platform, process.arch)[0]
    return (b?.size ?? 0) + MODELS.embed.size + MODELS.chat.size
  }

  /** The downloads still to do for a complete local setup. */
  private missing(): Step[] {
    const out: Step[] = []
    const b = this.build()
    if (b && !this.buildReady(b)) out.push({ size: b.size, run: (p) => this.fetchBuild(b, p) })
    for (const role of ROLES) {
      const m = MODELS[role]
      if (!this.modelReady(m)) out.push({ size: m.size, run: (p) => this.fetchModel(m, p) })
    }
    return out
  }

  // ---- downloading ----

  private async fetchModel(m: ModelSpec, progress: (bytes: number) => void): Promise<void> {
    mkdirSync(this.modelsDir, { recursive: true })
    await fetchVerified({
      url: m.url,
      sha256: m.sha256,
      dest: this.modelPath(m),
      label: m.name,
      signal: this.abort?.signal,
      onProgress: progress
    })
  }

  private async fetchBuild(b: RuntimeBuild, progress: (bytes: number) => void): Promise<void> {
    mkdirSync(this.runtimeDir, { recursive: true })
    const archiveName = `${b.id}${b.url.endsWith('.zip') ? '.zip' : '.tar.gz'}`
    await fetchVerified({
      url: b.url,
      sha256: b.sha256,
      dest: join(this.runtimeDir, archiveName),
      label: 'llama.cpp runtime',
      signal: this.abort?.signal,
      onProgress: progress
    })
    const dir = this.buildDir(b)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    // relative to the folder both live in, so no drive letter is ever on the command line
    // -m: Windows' tar cannot set the times stored in the zip and would call a good unpack a failure
    await run(tarCommand(), ['-xmf', archiveName, '-C', basename(dir)], this.runtimeDir).catch(
      (err: unknown) => {
        this.warnOnce('unpack', err)
        throw new Error('The runtime could not be unpacked')
      }
    )
    rmSync(join(this.runtimeDir, archiveName), { force: true })
    if (!this.binary(b)) throw new Error('The runtime did not contain llama-server')
    writeFileSync(join(dir, '.ok'), b.sha256)
  }

  /** Fetch whatever the local setup is missing. Safe to call twice: the second call joins the first. */
  install(): Promise<void> {
    if (this.downloading) return this.downloading
    if (this.moving) return Promise.reject(new Error('The models are being moved'))
    if (!this.supported)
      return Promise.reject(new Error('Local AI is not available on this system yet'))
    this.error = null
    this.abort = new AbortController()
    const steps = this.missing()
    const total = steps.reduce((n, s) => n + s.size, 0)
    let done = 0
    this.download = { received: 0, total }
    this.changed(true)
    this.downloading = (async () => {
      for (const step of steps) {
        let last = 0
        await step.run((got) => {
          done += got - last
          last = got
          this.download = { received: Math.min(done, total), total }
          this.changed()
        })
        done += step.size - last // the step finished: count it whole, whatever the server reported
      }
    })()
      .catch((err: unknown) => {
        if (this.abort?.signal.aborted) return
        this.error = err instanceof Error ? err.message : String(err)
        this.warnOnce('download', err)
      })
      .finally(() => {
        this.download = null
        this.downloading = null
        this.abort = null
        this.changed(true)
        if (this.installed && this.enabled && this.local) void this.warm()
      })
    return this.downloading
  }

  cancelInstall(): void {
    this.abort?.abort()
  }

  // ---- running ----

  /** The AI switch or the local provider changed. Off stops everything; on again clears a crash stop. */
  configure(enabled: boolean, local: boolean): void {
    const was = this.enabled
    this.enabled = enabled
    this.local = local
    if (!enabled || !local) {
      this.cancelInstall()
      this.stopAll()
    }
    if (enabled !== was) {
      this.blocked = false
      this.error = null
      for (const r of ROLES) {
        this.servers[r].crashes = []
        if (this.servers[r].state === 'error') this.servers[r].state = 'off'
      }
    }
    this.changed(true)
  }

  /** Bring both servers up (after a download): the first start also settles GPU against CPU. */
  async warm(): Promise<void> {
    for (const r of ROLES) await this.ensure(r).catch(() => undefined)
  }

  /** Whether a request could be answered by the local servers (installed and not stopped for crashing). */
  get available(): boolean {
    return (
      this.enabled &&
      this.local &&
      this.supported &&
      this.installed &&
      !this.blocked &&
      !this.moving
    )
  }

  /** Where to talk to a server, starting it if need be. Rejects if local AI is off, missing or keeps crashing. */
  ensure(role: ModelRole): Promise<Endpoint> {
    const s = this.servers[role]
    this.touchIdle(role)
    if (s.proc && s.state === 'ready') return Promise.resolve(this.endpoint(s))
    if (s.starting) return s.starting
    if (!this.enabled || !this.local) return Promise.reject(new Error('Local AI is off'))
    if (this.moving) return Promise.reject(new Error('The models are being moved'))
    if (this.blocked) return Promise.reject(new Error('Local AI stopped after repeated crashes'))
    if (!this.installed) return Promise.reject(new Error('The local model is not downloaded'))
    s.starting = this.start(role)
      .catch((err: unknown) => {
        s.state = 'error'
        s.message = err instanceof Error ? err.message : String(err)
        this.warnOnce(`start ${role}`, err)
        this.changed(true)
        throw err
      })
      .finally(() => {
        s.starting = null
      })
    return s.starting
  }

  private endpoint(s: Server): Endpoint {
    return { baseURL: `http://127.0.0.1:${s.port}/v1`, apiKey: s.key }
  }

  private touchIdle(role: ModelRole): void {
    const s = this.servers[role]
    if (s.idle) clearTimeout(s.idle)
    s.idle = setTimeout(() => this.stop(role), IDLE_MS[role])
    s.idle.unref()
  }

  private async start(role: ModelRole): Promise<Endpoint> {
    const s = this.servers[role]
    const first = this.build()
    if (!first) throw new Error('Local AI is not available on this system yet')
    let b: RuntimeBuild = first
    for (;;) {
      const bin = this.binary(b)
      if (!bin) throw new Error('The runtime is missing. Download the local model again.')
      s.state = 'starting'
      s.message = b.gpu ? 'Starting (GPU)' : 'Starting'
      s.key = randomBytes(32).toString('hex')
      s.port = await freePort()
      s.stopping = false
      this.changed(true)
      const args = serverArgs({
        role,
        modelPath: this.modelPath(MODELS[role]),
        port: s.port,
        apiKey: s.key,
        gpu: b.gpu
      })
      const proc = spawn(bin, args, {
        cwd: dirname(bin),
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })
      s.proc = proc
      let tail = ''
      proc.stderr?.on('data', (c: Buffer) => {
        tail = (tail + c.toString()).slice(-1500)
      })
      const exited = new Promise<boolean>((resolve) => {
        proc.once('exit', (code) => {
          if (s.proc === proc) s.proc = null
          if (!s.stopping) this.onExit(role, code, tail)
          resolve(false)
        })
        proc.once('error', (err) => {
          this.warnOnce(`spawn ${role}`, err)
          resolve(false)
        })
      })
      const fallback = b.gpu
        ? runtimeBuildsFor(process.platform, process.arch).find((x) => !x.gpu)
        : undefined
      const limit = b.gpu && fallback ? GPU_HEALTH_MS : CPU_HEALTH_MS
      const healthy = await Promise.race([this.waitHealthy(s.port, limit, proc), exited])
      if (healthy) {
        s.state = 'ready'
        s.message = ''
        this.accel = b.gpu ? 'gpu' : 'cpu'
        this.dropOldRuntimes()
        this.changed(true)
        return this.endpoint(s)
      }
      s.stopping = true
      proc.kill()
      s.proc = null
      if (!fallback) throw new Error(`The ${role} model did not start. ${lastLine(tail)}`.trim())
      // The GPU build would not come up (no usable Vulkan driver, say): stay on the CPU one from now on.
      this.warnOnce('gpu', `GPU build did not start, using the CPU build. ${lastLine(tail)}`)
      this.setCpuOnly(true)
      if (!this.buildReady(fallback)) await this.fetchFallback(fallback)
      b = fallback
    }
  }

  private async fetchFallback(b: RuntimeBuild): Promise<void> {
    this.abort = new AbortController()
    this.download = { received: 0, total: b.size }
    this.changed(true)
    try {
      await this.fetchBuild(b, (n) => {
        this.download = { received: n, total: b.size }
        this.changed()
      })
    } finally {
      this.download = null
      this.abort = null
    }
  }

  private async waitHealthy(port: number, limitMs: number, proc: ChildProcess): Promise<boolean> {
    const until = Date.now() + limitMs
    while (Date.now() < until && proc.exitCode === null) {
      try {
        const url = `http://127.0.0.1:${port}/health`
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
        if (res.ok) return true
      } catch {
        // not listening yet
      }
      await sleep(250)
    }
    return false
  }

  private onExit(role: ModelRole, code: number | null, tail: string): void {
    const s = this.servers[role]
    const now = Date.now()
    s.crashes = [...s.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now]
    s.state = 'off'
    s.message = ''
    this.warnOnce(`exit ${role}`, `stopped (${code}) ${lastLine(tail)}`)
    if (s.crashes.length >= CRASH_LIMIT) {
      this.blocked = true
      s.state = 'error'
      s.message = 'Stopped unexpectedly three times. Turn AI off and on to try again.'
    }
    this.changed(true)
  }

  stop(role: ModelRole): void {
    const s = this.servers[role]
    if (s.idle) clearTimeout(s.idle)
    s.idle = null
    const p = s.proc
    s.proc = null
    if (p) {
      s.stopping = true
      p.kill()
    }
    if (s.state !== 'error') {
      s.state = 'off'
      s.message = ''
    }
    this.changed(true)
  }

  stopAll(): void {
    for (const r of ROLES) this.stop(r)
  }

  /** Leave only the builds this version knows about (older llama.cpp builds and half-made folders go). */
  private dropOldRuntimes(): void {
    try {
      const keep = new Set(RUNTIME_BUILDS.map((b) => b.id))
      for (const name of readdirSync(this.runtimeDir)) {
        if (!keep.has(name)) rmSync(join(this.runtimeDir, name), { recursive: true, force: true })
      }
    } catch {
      // nothing to tidy
    }
  }

  /** Forget the GPU failure and any error, and try again (the Retry button). */
  retry(): void {
    this.setCpuOnly(false)
    this.error = null
    this.blocked = false
    for (const r of ROLES) {
      this.servers[r].crashes = []
      if (this.servers[r].state === 'error') this.servers[r].state = 'off'
    }
    this.changed(true)
    if (!this.installed) void this.install()
    else if (this.enabled && this.local) void this.warm()
  }

  /** Delete the runtime and models. */
  removeLocal(): void {
    this.cancelInstall()
    this.stopAll()
    rmSync(this.runtimeDir, { recursive: true, force: true })
    this.removeModelFiles()
    this.accel = null
    this.error = null
    this.changed(true)
  }

  /** Delete everything in the AI folder (the caller clears its own in-memory state). */
  removeAll(): void {
    this.cancelInstall()
    this.stopAll()
    // a server just killed can hold its files for a moment on Windows
    this.removeModelFiles()
    rmSync(aiRoot(), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    this.accel = null
    this.error = null
    this.blocked = false
    this.changed(true)
  }

  /**
   * Only Panes' own model files (and half-downloaded ones) go: a folder the user picked may hold other things,
   * so it is never removed whole. The default folder, which is Panes' alone, goes too.
   */
  private removeModelFiles(): void {
    const dir = this.modelsDir
    for (const m of Object.values(MODELS)) {
      for (const f of [m.file, `${m.file}.part`])
        rmSync(join(dir, f), { force: true, maxRetries: 10, retryDelay: 200 })
    }
    rmSync(defaultModelsDir(), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }

  /** Bytes the model files take outside the data folder (a picked folder), for the settings page. */
  externalModelBytes(): number {
    if (!this.customDir()) return 0
    let total = 0
    for (const m of Object.values(MODELS)) {
      try {
        total += statSync(join(this.modelsDir, m.file)).size
      } catch {
        // not downloaded
      }
    }
    return total
  }

  /**
   * Move the downloaded models into `to` (they are not downloaded again): a rename on the same drive, a copy
   * across drives. If any file fails, the ones already renamed go back and nothing changes. `commit` records the
   * new folder once every file is in place, before the old copies are deleted.
   */
  async moveModels(to: string, commit: () => void): Promise<void> {
    if (this.downloading) throw new Error('Wait for the download to finish first')
    if (this.moving) throw new Error('The models are already being moved')
    const from = this.modelsDir
    if (samePath(from, to)) return commit()
    this.moving = true
    this.stopAll()
    this.changed(true)
    const moved: Array<{ src: string; dest: string; how: 'rename' | 'copy' | 'there' }> = []
    try {
      mkdirSync(to, { recursive: true })
      const probe = join(to, `.panes-${randomBytes(4).toString('hex')}`)
      try {
        writeFileSync(probe, '')
        rmSync(probe, { force: true })
      } catch {
        throw new Error('Panes cannot write to that folder')
      }
      const files = Object.values(MODELS).filter((m) => existsSync(join(from, m.file)))
      const there = (m: ModelSpec): boolean => {
        try {
          return statSync(join(to, m.file)).size === m.size
        } catch {
          return false
        }
      }
      const need = files.reduce((n, m) => (there(m) ? n : n + m.size), 0)
      let free = Infinity
      try {
        const fs = statfsSync(to)
        free = fs.bavail * fs.bsize
      } catch {
        // free space is not known on every file system: try anyway
      }
      // a rename on the same drive needs no room, but a copy does, and which one it is shows only when tried
      if (need > free)
        throw new Error(`Not enough free space there (${Math.ceil(need / 1e6)} MB needed)`)
      for (const m of files) {
        const src = join(from, m.file)
        const dest = join(to, m.file)
        // the same model already there (moved before, or copied by hand): keep it, drop ours afterwards
        if (there(m)) {
          moved.push({ src, dest, how: 'there' })
          continue
        }
        try {
          await rename(src, dest)
          moved.push({ src, dest, how: 'rename' })
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
          const part = `${dest}.part`
          await copyFile(src, part)
          await rename(part, dest)
          moved.push({ src, dest, how: 'copy' })
        }
      }
      commit()
      for (const x of moved)
        if (x.how !== 'rename') await rm(x.src, { force: true }).catch(() => undefined)
      for (const m of Object.values(MODELS))
        await rm(join(from, `${m.file}.part`), { force: true }).catch(() => undefined)
      if (samePath(from, defaultModelsDir()))
        await rm(from, { recursive: true, force: true }).catch(() => undefined)
    } catch (err) {
      // put back what was renamed and drop the copies made here; the originals were not touched
      for (const x of moved.reverse()) {
        if (x.how === 'rename')
          await rename(x.dest, x.src).catch((e: unknown) => this.warnOnce('move back', e))
        else if (x.how === 'copy') await rm(x.dest, { force: true }).catch(() => undefined)
      }
      for (const m of Object.values(MODELS))
        await rm(join(to, `${m.file}.part`), { force: true }).catch(() => undefined)
      this.warnOnce('move', err)
      throw err instanceof Error ? err : new Error(String(err))
    } finally {
      this.moving = false
      this.changed(true)
      if (this.installed && this.enabled && this.local) void this.warm()
    }
  }

  // ---- what the settings page shows ----

  private serverStatus(role: ModelRole): ServerStatus {
    const m = MODELS[role]
    const s = this.servers[role]
    const base = { modelName: m.name, modelSize: m.size }
    if (!this.enabled) return { ...base, state: 'off', message: 'AI is off' }
    if (!this.supported)
      return { ...base, state: 'error', message: 'Not available on this system yet' }
    if (!this.local) return { ...base, state: 'off', message: 'Using your own server' }
    if (this.moving) return { ...base, state: 'off', message: 'Moving' }
    if (this.downloading || this.download)
      return { ...base, state: 'downloading', message: 'Downloading' }
    if (s.state === 'error') return { ...base, state: 'error', message: s.message }
    if (!this.installed) return { ...base, state: 'needs-download', message: 'Not downloaded' }
    if (s.state === 'starting') return { ...base, state: 'starting', message: s.message }
    if (s.state === 'ready') return { ...base, state: 'ready', message: 'Running' }
    return { ...base, state: 'off', message: 'Starts when needed' }
  }

  snapshot(): Omit<AiStatus, 'keys' | 'dataBytes' | 'signIn' | 'chatgptLimited' | 'chatgptReauth'> {
    return {
      enabled: this.enabled,
      supported: this.supported,
      installed: this.installed,
      embed: this.serverStatus('embed'),
      chat: this.serverStatus('chat'),
      download: this.download,
      installBytes: this.fullSize(),
      accel: this.accel,
      error: this.error,
      modelsDir: this.modelsDir,
      modelsDirCustom: !!this.customDir(),
      moving: this.moving
    }
  }
}
