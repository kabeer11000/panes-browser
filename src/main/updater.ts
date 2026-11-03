import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { existsSync, rmSync, writeFileSync } from 'fs'
import { showInstallProgress } from './installProgress'
import { join } from 'path'
import {
  FeedMissing,
  fetchManifest,
  layerFeed,
  newestBuildHere,
  readLayerState,
  stageFromManifest,
  thisShell
} from './layers'
import { planLayerUpdate } from '@shared/layers'
import {
  friendlyUpdateError,
  nextUpdateState,
  notesText,
  type UpdateEvent,
  type UpdateState
} from '@shared/update'

const FIRST_CHECK_DELAY_MS = 15_000 // let the window settle before touching the network
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
/** Written when Restart to update is chosen, so the next start brings the tabs back whatever the startup setting. */
const RESTORE_FLAG = 'restore-after-update'

/** Why this build cannot update itself, or null if it can. */
function whyDisabled(): string | null {
  if (!app.isPackaged) return 'Updates are only available in installed builds.'
  // electron-builder writes this next to the app when a publish target is configured.
  if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    return 'This build was made without an update feed.'
  }
  return null
}

const message = (err: unknown): string =>
  friendlyUpdateError(String((err as Error)?.message ?? err))

/**
 * Keeps Panes current. Checks on launch and every few hours. A release of Panes' own code arrives as an app layer
 * (shared/layers.ts): usually a delta of a couple hundred KB, staged beside the running code and started the next
 * time Panes opens, so nothing is installed and nobody waits. Only a release on a new Electron goes through the
 * installer (electron-updater), which downloads in the background and installs on restart or quit.
 * PANES_FAKE_UPDATE=1 in an unpackaged build plays a scripted update, so the UI can be tried without a release.
 */
export class UpdateManager {
  private state: UpdateState
  private listeners = new Set<(s: UpdateState) => void>()
  private fake = !app.isPackaged && process.env['PANES_FAKE_UPDATE'] === '1'
  private timers: NodeJS.Timeout[] = []
  private feed = layerFeed()
  /** How the update that is ready gets used: start the staged layer, or run the installer. */
  private via: 'layer' | 'installer' | null = null

  constructor() {
    const reason = this.fake ? null : whyDisabled()
    this.state = reason ? { kind: 'disabled', reason } : { kind: 'idle', checkedAt: null }
    if (reason || this.fake) return

    autoUpdater.autoDownload = true // only ever asked when a release needs the installer
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
    autoUpdater.on('update-downloaded', () => {
      this.via = 'installer'
      this.dispatch({ type: 'downloaded' })
    })
    autoUpdater.on('error', (err) => {
      this.dispatch({ type: 'error', message: message(err), at: Date.now() })
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
      s === 'ready' ||
      s === 'installing'
    )
      return
    if (this.fake) return this.playFake()
    this.dispatch({ type: 'checking' })
    void this.checkNow()
  }

  private async checkNow(): Promise<void> {
    if (this.feed) {
      try {
        const manifest = await fetchManifest(this.feed)
        const here = readLayerState()
        const plan = planLayerUpdate(manifest, {
          shell: thisShell(),
          newest: newestBuildHere(here),
          bad: here.bad
        })
        if (plan === 'none') return this.dispatch({ type: 'none', at: Date.now() })
        if (plan === 'layer') {
          this.dispatch({ type: 'found', version: manifest.version, notes: manifest.notes })
          await stageFromManifest(manifest, this.feed, (fraction, bytesPerSecond) =>
            this.dispatch({ type: 'progress', percent: fraction * 100, bytesPerSecond })
          )
          this.via = 'layer'
          return this.dispatch({ type: 'downloaded' })
        }
        // plan === 'installer': the release is on a newer Electron, which only the installer brings
      } catch (err) {
        if (err instanceof FeedMissing) {
          // The latest release has no layer yet (still uploading, or made without one). Its installer would be a
          // full 123 MB download of code that may already be here, so wait for the next check instead.
          console.warn('[updater]', err.message)
          return this.dispatch({ type: 'none', at: Date.now() })
        }
        this.dispatch({ type: 'error', message: message(err), at: Date.now() })
        return this.retrySoon()
      }
    }
    autoUpdater
      .checkForUpdates()
      .catch((err: unknown) =>
        this.dispatch({ type: 'error', message: message(err), at: Date.now() })
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

  /**
   * The one-shot "bring the tabs back" flag set by Restart to update. Read once at startup: true when this start is
   * that restart, whatever the startup setting says.
   */
  static takeRestoreFlag(): boolean {
    const file = join(app.getPath('userData'), RESTORE_FLAG)
    if (!existsSync(file)) return false
    try {
      rmSync(file, { force: true })
    } catch {
      // still restore: worst case the next start restores too
    }
    return true
  }

  /** Restart into the downloaded version. Does nothing unless one is ready. */
  install(): void {
    if (this.state.kind !== 'ready' || this.fake) return
    this.dispatch({ type: 'installing' }) // the window says so at once
    try {
      writeFileSync(join(app.getPath('userData'), RESTORE_FLAG), '')
    } catch {
      // the restart still happens; tabs come back only if the startup setting says so
    }
    if (this.via === 'layer') {
      // The new code is already on disk: this is an ordinary restart. Electron starts the new process once this
      // one has exited, so it gets the single-instance lock.
      app.relaunch()
      app.quit()
      return
    }
    if (process.platform === 'win32') showInstallProgress()
    // a moment for that to be drawn before the window goes
    setTimeout(() => this.quitIntoInstaller(), 900)
  }

  private quitIntoInstaller(): void {
    // Silent: the new version is put in place without the installer wizard, and Panes starts again by itself.
    autoUpdater.quitAndInstall(true, true)
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
