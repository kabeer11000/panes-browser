import { app, dialog, type BrowserWindow } from 'electron'
import { readFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import {
  BROWSER_SOURCES,
  chromiumProfiles,
  firefoxProfiles,
  htmlBookmarks,
  searchEngineFor,
  sourceRoot,
  type BrowserSource
} from '@shared/importers'
import type { ImportItem, ImportResult, ImportSource } from '@shared/types'
import { MAX_ENTRIES, type BookmarkStore, type HistoryStore } from './history'
import type { PasswordStore } from './passwords'
import type { SettingsStore } from './settings'
import readProfile from './importWorker?nodeWorker'
import type { ImportJob, ImportReply } from './importWorker'

const ITEMS: ImportItem[] = ['bookmarks', 'history', 'search']

interface Deps {
  win: BrowserWindow
  history: HistoryStore
  bookmarks: BookmarkStore
  settings: SettingsStore
  passwords: PasswordStore
}

/**
 * Bring bookmarks, history and the search engine over from another browser on this computer, and passwords
 * from the CSV file the other browser exports. Passwords and cookies are never read from the other browser's
 * own files: Chrome and Edge lock them to themselves, and reading them is what credential stealers do.
 */
export class Importer {
  /** The password CSV last imported, the only file Panes will offer to delete. */
  private csvPath: string | null = null

  constructor(private d: Deps) {}

  private root(s: BrowserSource): string | null {
    return sourceRoot(s, process.platform, process.env, homedir().replace(/\\/g, '/'))
  }

  private async profiles(s: BrowserSource, root: string): Promise<ImportSource['profiles']> {
    const text = (name: string): Promise<string | null> =>
      readFile(resolve(root, name), 'utf8').catch(() => null)
    if (s.singleProfile) return [{ dir: '.', name: s.name }]
    if (s.family === 'chromium') return chromiumProfiles(await text('Local State'))
    return firefoxProfiles((await text('profiles.ini')) ?? '')
  }

  async sources(): Promise<ImportSource[]> {
    const defaultName = app.getApplicationNameForProtocol('https://')
    const found = await Promise.all(
      BROWSER_SOURCES.map(async (s) => {
        const root = this.root(s)
        if (!root) return null
        const exists = await readFile(
          resolve(
            root,
            s.family === 'firefox'
              ? 'profiles.ini'
              : s.singleProfile
                ? 'Preferences'
                : 'Local State'
          )
        ).then(
          () => true,
          () => false
        )
        if (!exists) return null
        const profiles = await this.profiles(s, root)
        if (!profiles.length) return null
        return {
          id: s.id,
          name: s.name,
          profiles,
          isDefault: s.match.test(defaultName),
          canSearch: s.family === 'chromium',
          passwordExport: s.passwordExport
        }
      })
    )
    return found
      .filter((s): s is ImportSource => s !== null)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
  }

  async run(sourceId: string, profileDir: string, items: ImportItem[]): Promise<ImportResult> {
    const source = BROWSER_SOURCES.find((s) => s.id === sourceId)
    const root = source && this.root(source)
    // only a profile this browser lists: the page never names a folder of its own choosing
    if (
      !source ||
      !root ||
      !(await this.profiles(source, root)).some((p) => p.dir === profileDir)
    ) {
      return { ok: false, error: 'missing' }
    }
    const job: ImportJob = {
      family: source.family,
      profile: resolve(root, profileDir),
      items: items.filter((i) => ITEMS.includes(i)),
      historyLimit: MAX_ENTRIES
    }
    const reply = await new Promise<ImportReply>((done) => {
      const worker = readProfile({ workerData: job })
      worker.once('message', (msg: ImportReply) => {
        void worker.terminate()
        done(msg)
      })
      worker.once('error', (err) => done({ error: 'failed', detail: String(err) }))
      worker.once('exit', (code) => done({ error: 'failed', detail: `worker exited (${code})` })) // no-op after a reply
    })
    if ('error' in reply) {
      if (reply.detail) console.error(`[import] ${source.id}: ${reply.detail}`)
      return { ok: false, error: reply.error }
    }
    const search = searchEngineFor(reply.searchUrl)
    if (search) this.d.settings.update({ searchEngine: search })
    return {
      ok: true,
      bookmarks: this.d.bookmarks.importMany(reply.bookmarks),
      history: this.d.history.importMany(reply.history),
      search
    }
  }

  private async pick(name: string, extensions: string[]): Promise<string | null> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.d.win, {
      properties: ['openFile'],
      filters: [{ name, extensions }]
    })
    return canceled ? null : (filePaths[0] ?? null)
  }

  async passwordsFile(): Promise<{ added: number; skipped: number } | null> {
    const file = await this.pick('Passwords', ['csv'])
    if (!file) return null
    const result = this.d.passwords.importCsv(await readFile(file, 'utf8'))
    this.csvPath = file
    return result
  }

  async deletePasswordsFile(): Promise<boolean> {
    if (!this.csvPath) return false
    const file = this.csvPath
    this.csvPath = null
    return unlink(file).then(
      () => true,
      (err: unknown) => {
        console.error(`[import] could not delete the password file: ${String(err)}`)
        return false
      }
    )
  }

  async bookmarksFile(): Promise<number | null> {
    const file = await this.pick('Bookmarks', ['html', 'htm'])
    if (!file) return null
    return this.d.bookmarks.importMany(htmlBookmarks(await readFile(file, 'utf8')))
  }
}
