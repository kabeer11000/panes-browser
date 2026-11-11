import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { PasswordStore } from './passwords'
import {
  isBrowserPasswordCsv,
  looksLikePasswordExport,
  type PasswordExportResult
} from '@shared/passwordExport'

/**
 * Passwords stay with the other browser until the person exports them: Panes never reads another browser's password
 * store (that is what credential stealers do, and the files are locked to that browser anyway). Instead this opens
 * the browser straight at its own "export passwords" page — the browser authenticates the person — and then watches
 * the Downloads folder for the CSV it writes, imports it, and deletes it. One guided step instead of a manual export,
 * a file dialog and a cleanup.
 */

interface Launch {
  /** The App Paths key Windows registers the browser under, used to find its executable. */
  exe: string
  /** The page that offers "Export passwords", opened as a command-line argument. */
  url: string
}

const BROWSERS: Record<string, Launch> = {
  chrome: { exe: 'chrome.exe', url: 'chrome://password-manager/settings' },
  edge: { exe: 'msedge.exe', url: 'edge://settings/passwords' },
  brave: { exe: 'brave.exe', url: 'brave://password-manager/settings' },
  vivaldi: { exe: 'vivaldi.exe', url: 'chrome://password-manager/settings' },
  opera: { exe: 'opera.exe', url: 'opera://settings/passwords' },
  firefox: { exe: 'firefox.exe', url: 'about:logins' },
  zen: { exe: 'zen.exe', url: 'about:logins' },
  librewolf: { exe: 'librewolf.exe', url: 'about:logins' }
}

const WATCH_MS = 15 * 60_000
const POLL_MS = 1500

export type ExportResult = PasswordExportResult

export class PasswordExport {
  private timer: NodeJS.Timeout | null = null
  /** Bumped by every start and cancel: a look still awaiting the disk from an older watch sees it and stops. */
  private gen = 0
  private notify: (r: ExportResult) => void = () => undefined

  constructor(private d: { passwords: PasswordStore }) {}

  /** Open `sourceId`'s export page and begin watching Downloads; `notify` is called once the CSV is imported. */
  async start(
    sourceId: string,
    notify: (r: ExportResult) => void
  ): Promise<{ status: 'opened' | 'watching' | 'unsupported' }> {
    const browser = BROWSERS[sourceId]
    if (!browser || process.platform !== 'win32') return { status: 'unsupported' }
    this.cancel()
    const gen = this.gen
    this.notify = notify
    const exe = await this.findExe(browser.exe)
    if (gen !== this.gen) return { status: 'watching' } // another start or a cancel came while we looked
    const opened = exe ? await this.launch(exe, browser.url) : false
    if (gen !== this.gen) return { status: opened ? 'opened' : 'watching' }
    void this.watch(sourceId, gen)
    return { status: opened ? 'opened' : 'watching' }
  }

  cancel(): void {
    this.gen++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /**
   * Start the browser at its export page. A missing executable (an App Paths entry left by an uninstalled browser)
   * is reported by spawn as an 'error' event, not a throw: it is caught here, so it never takes main down.
   */
  private launch(exe: string, url: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const child = spawn(exe, [url], { detached: true, stdio: 'ignore' })
        child.once('error', () => resolve(false))
        child.once('spawn', () => {
          child.unref()
          resolve(true)
        })
      } catch {
        resolve(false)
      }
    })
  }

  /** The browser's executable from the registry's App Paths (per-user first, then machine), or null. */
  private findExe(key: string): Promise<string | null> {
    const roots = [
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\'
    ]
    const query = (path: string): Promise<string | null> =>
      new Promise((resolve) => {
        execFile('reg', ['query', path, '/ve'], { windowsHide: true }, (err, stdout) => {
          if (err) return resolve(null)
          const m = /REG_SZ\s+(.+?)\s*$/m.exec(stdout)
          resolve(m ? m[1].replace(/^"|"$/g, '') : null)
        })
      })
    return roots.reduce<Promise<string | null>>(
      (acc, root) => acc.then((found) => found ?? query(root + key)),
      Promise.resolve(null)
    )
  }

  /**
   * Watch Downloads for a new password export, import it once it has finished writing, then delete it. Only a file
   * named like an export whose header is a browser's export is touched; anything else is left where it is.
   */
  private async watch(sourceId: string, gen: number): Promise<void> {
    const dir = app.getPath('downloads')
    const since = Date.now() - 2000 // a file the export wrote a moment before we started still counts
    const deadline = Date.now() + WATCH_MS
    const seen = new Map<string, number>() // candidate -> last size, so we import only once it stops growing
    const ignored = new Set<string>() // looked at and not an export: never read again
    const live = (): boolean => gen === this.gen

    const look = async (): Promise<void> => {
      if (!live()) return
      if (Date.now() > deadline) {
        this.cancel()
        return this.notify({ sourceId, added: 0, skipped: 0, deleted: false, timedOut: true })
      }
      let names: string[] = []
      try {
        names = await readdir(dir)
      } catch {
        // Downloads gone or unreadable: try again next tick
      }
      for (const name of names.filter((n) => looksLikePasswordExport(n) && !ignored.has(n))) {
        if (!live()) return
        const file = join(dir, name)
        try {
          const s = await stat(file)
          if (s.mtimeMs < since || s.size === 0) continue
          const was = seen.get(name)
          seen.set(name, s.size)
          if (was === undefined || was !== s.size) continue // still being written; check again next tick
          const csv = await readFile(file, 'utf8')
          if (!live()) return
          if (!isBrowserPasswordCsv(csv)) {
            ignored.add(name)
            continue
          }
          const { added, skipped } = this.d.passwords.importCsv(csv)
          this.cancel() // this watch is over: nothing else reads or deletes from here on
          const deleted = await unlink(file).then(
            () => true,
            () => false
          )
          this.notify({ sourceId, added, skipped, deleted })
          return
        } catch {
          // mid-write or vanished: ignore and keep watching
        }
      }
      if (live()) this.timer = setTimeout(() => void look(), POLL_MS)
    }
    await look()
  }
}
