import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  friendlyUpdateError,
  nextUpdateState,
  notesText,
  type UpdateEvent,
  type UpdateState
} from '../shared/update'

const FIRST_CHECK_DELAY_MS = 15_000 // let the window settle before touching the network
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

/** Why this build cannot update itself, or null if it can. */
function whyDisabled(): string | null {
  if (!app.isPackaged) return 'Updates are only available in installed builds.'
  // electron-builder writes this next to the app when a publish target is configured.
  if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    return 'This build was made without an update feed.'
  }
  return null
}

/**
 * Keeps Panes current: checks on launch and every few hours, downloads in the background, and then waits
 * for the user to restart into the new version (or quits into it the next time they close the app).
 * PANES_FAKE_UPDATE=1 in an unpackaged build plays a scripted update, so the UI can be tried without a release.
 */
export class UpdateManager {
  private state: UpdateState
  private listeners = new Set<(s: UpdateState) => void>()
  private fake = !app.isPackaged && process.env['PANES_FAKE_UPDATE'] === '1'
  private timers: NodeJS.Timeout[] = []

  constructor() {
    const reason = this.fake ? null : whyDisabled()
    this.state = reason ? { kind: 'disabled', reason } : { kind: 'idle', checkedAt: null }
    if (reason || this.fake) return

    autoUpdater.autoDownload = true
    // The installer is fetched whole. Differential downloads read pieces of it over many range requests that
    // GitHub answers with redirects; when one fails, or the asset changed while a release was still being
    // uploaded, the update ends in a protocol or checksum error instead of simply downloading again.
    autoUpdater.disableDifferentialDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => this.dispatch({ type: 'checking' }))
    autoUpdater.on('update-not-available', () => this.dispatch({ type: 'none', at: Date.now() }))
    autoUpdater.on('update-available', (info) =>
      this.dispatch({ type: 'found', version: info.version, notes: notesText(info.releaseNotes) })
    )
    autoUpdater.on('download-progress', (p) =>
      this.dispatch({ type: 'progress', percent: p.percent, bytesPerSecond: p.bytesPerSecond })
    )
    autoUpdater.on('update-downloaded', () => this.dispatch({ type: 'downloaded' }))
    autoUpdater.on('error', (err) => {
      this.dispatch({
        type: 'error',
        message: friendlyUpdateError(String(err?.message ?? err)),
        at: Date.now()
      })
      this.retrySoon()
    })
  }

  get(): UpdateState {
    return this.state
  }

  onChange(cb: (s: UpdateState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Begin the automatic checks. Safe to call on a build that cannot update: it does nothing. */
  start(): void {
    if (this.state.kind === 'disabled') return
    const first = setTimeout(() => this.check(), FIRST_CHECK_DELAY_MS)
    const every = setInterval(() => this.check(), CHECK_EVERY_MS)
    first.unref()
    every.unref()
    this.timers.push(first, every)
  }

  check(): void {
    const s = this.state.kind
    // Already looking, already got one, or nothing to do on this build.
    if (
      s === 'disabled' ||
      s === 'checking' ||
      s === 'available' ||
      s === 'downloading' ||
      s === 'ready'
    )
      return
    if (this.fake) return this.playFake()
    this.dispatch({ type: 'checking' })
    autoUpdater.checkForUpdates().catch((err: unknown) =>
      this.dispatch({
        type: 'error',
        message: friendlyUpdateError(String((err as Error)?.message ?? err)),
        at: Date.now()
      })
    )
  }

  /** A failed check or download is tried once more shortly: most are a release still being uploaded. */
  private retried = false
  private retrySoon(): void {
    if (this.retried) return
    this.retried = true
    const t = setTimeout(() => {
      this.retried = false
      if (this.state.kind === 'error') this.check()
    }, 90_000)
    t.unref()
    this.timers.push(t)
  }

  /** Restart into the downloaded version. Does nothing unless one is ready. */
  install(): void {
    if (this.state.kind !== 'ready' || this.fake) return
    autoUpdater.quitAndInstall(false, true)
  }

  private dispatch(e: UpdateEvent): void {
    const next = nextUpdateState(this.state, e)
    if (next === this.state) return
    this.state = next
    for (const cb of this.listeners) cb(next)
  }

  private playFake(): void {
    const at = (ms: number, e: UpdateEvent): void => void setTimeout(() => this.dispatch(e), ms)
    this.dispatch({ type: 'checking' })
    at(900, {
      type: 'found',
      version: '9.9.9',
      notes: 'A pretend update.\nFaster tab stack.\nA new Software page.'
    })
    for (let i = 1; i <= 20; i++) {
      at(900 + i * 200, { type: 'progress', percent: i * 5, bytesPerSecond: 1.4 * 1024 * 1024 })
    }
    at(900 + 21 * 200, { type: 'downloaded' })
  }
}
