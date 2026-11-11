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
import type {
  ImportAllResult,
  ImportItem,
  ImportProgress,
  ImportResult,
  ImportSource,
  SearchEngineId
} from '@shared/types'
import { MAX_SESSION_TABS, type SessionTab } from '@shared/sessionImport'
import { MAX_ENTRIES, type BookmarkStore, type HistoryStore } from './history'
import type { PasswordStore } from './passwords'
import type { SettingsStore } from './settings'
import readProfile from './importWorker?nodeWorker'
import type { ImportJob, ImportReply } from './importWorker'

const ITEMS: ImportItem[] = ['bookmarks', 'history', 'search', 'tabs']

interface Deps {
  win: BrowserWindow
  history: HistoryStore
  bookmarks: BookmarkStore
  settings: SettingsStore
  passwords: PasswordStore
  /**
   * Open another browser's tabs in the active space, unloaded and in one group, without taking focus; how many
   * opened (one already open there is not opened again).
   */
  addImportedTabs: (groupName: string, tabs: SessionTab[]) => number
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

  /**
   * Read one profile in the worker. Only a profile this browser lists is read: the page never names a folder
   * of its own choosing. A locked reply may still carry the open tabs, read from a file copy the lock allows.
   */
  private async runWorker(
    source: BrowserSource,
    profileDir: string,
    items: ImportItem[]
  ): Promise<ImportReply> {
    const root = this.root(source)
    if (!root || !(await this.profiles(source, root)).some((p) => p.dir === profileDir)) {
      return { error: 'missing' }
    }
    const job: ImportJob = {
      family: source.family,
      profile: resolve(root, profileDir),
      items: items.filter((i) => ITEMS.includes(i)),
      historyLimit: MAX_ENTRIES
    }
    return new Promise<ImportReply>((done) => {
      const worker = readProfile({ workerData: job })
      worker.once('message', (msg: ImportReply) => {
        void worker.terminate()
        done(msg)
      })
      worker.once('error', (err) => done({ error: 'failed', detail: String(err) }))
      worker.once('exit', (code) => done({ error: 'failed', detail: `worker exited (${code})` })) // no-op after a reply
    })
  }

  /** The tab group a source's imported tabs land in, named after the browser they came from. */
  private groupName(name: string): string {
    return `From ${name}`
  }

  async run(sourceId: string, profileDir: string, items: ImportItem[]): Promise<ImportResult> {
    const source = BROWSER_SOURCES.find((s) => s.id === sourceId)
    if (!source) return { ok: false, error: 'missing' }
    const reply = await this.runWorker(source, profileDir, items)
    if ('error' in reply) {
      if (reply.detail) console.error(`[import] ${source.id}: ${reply.detail}`)
      // even a locked profile may have given up its open tabs
      if (reply.tabs?.length) this.d.addImportedTabs(this.groupName(source.name), reply.tabs)
      return { ok: false, error: reply.error }
    }
    const search = searchEngineFor(reply.searchUrl)
    if (search) this.d.settings.update({ searchEngine: search })
    const tabs = reply.tabs.length
      ? this.d.addImportedTabs(this.groupName(source.name), reply.tabs)
      : 0
    return {
      ok: true,
      bookmarks: this.d.bookmarks.importMany(reply.bookmarks),
      history: this.d.history.importMany(reply.history),
      search,
      tabs,
      ...(reply.historyLocked ? { historyLocked: true } : {})
    }
  }

  /** The one-click import under way, so a second click (or the step shown again) joins it instead of doubling it. */
  private importing: Promise<ImportAllResult> | null = null

  /**
   * One click: bring the chosen items over from every browser found on this computer (or only those in `only`, to
   * retry one), every profile. Bookmarks and history merge in; the open tabs of all a browser's profiles open as
   * one group named after it (see addImportedTabs), at most MAX_SESSION_TABS of them; the search engine is taken
   * only from the system's default browser. Progress is reported per source so a slow or locked one shows up as it
   * happens. A locked browser (it is running) does not fail the run: what it does not hold still comes over, and
   * the rest of the browsers import.
   */
  importAll(
    items: ImportItem[],
    onProgress: (p: ImportProgress) => void,
    only?: string[]
  ): Promise<ImportAllResult> {
    if (this.importing) return this.importing
    const run = this.importAllNow(items, onProgress, only)
    this.importing = run
    const done = (): void => {
      this.importing = null
    }
    run.then(done, done)
    return run
  }

  private async importAllNow(
    items: ImportItem[],
    onProgress: (p: ImportProgress) => void,
    only?: string[]
  ): Promise<ImportAllResult> {
    const out: ImportAllResult['sources'] = []
    let search: SearchEngineId | null = null
    const found = (await this.sources()).filter((s) => !only || only.includes(s.id))
    for (const src of found) {
      const source = BROWSER_SOURCES.find((s) => s.id === src.id)
      const base = { id: src.id, name: src.name, bookmarks: 0, history: 0, tabs: 0 }
      if (!source) {
        // listed but not one this build can read: settled at once, never left "reading"
        onProgress({ ...base, state: 'failed' })
        out.push({ ...base, error: 'missing' })
        continue
      }
      onProgress({ ...base, state: 'reading' })

      let bookmarks = 0
      let history = 0
      let anyOk = false
      let locked = false
      let historyLocked = false
      const sessionTabs: SessionTab[] = []
      for (const profile of src.profiles) {
        const reply = await this.runWorker(source, profile.dir, items)
        // present on success, and on a locked reply that still copied the session file
        sessionTabs.push(...(reply.tabs ?? []))
        if ('error' in reply) {
          if (reply.detail) console.error(`[import] ${source.id}: ${reply.detail}`)
          if (reply.error === 'locked') locked = true
          continue
        }
        anyOk = true
        if (reply.historyLocked) historyLocked = true
        bookmarks += this.d.bookmarks.importMany(reply.bookmarks)
        history += this.d.history.importMany(reply.history)
        // the search engine comes from the default browser alone, and only the first one that offers it
        if (src.isDefault && search === null) {
          const s = searchEngineFor(reply.searchUrl)
          if (s) {
            search = s
            this.d.settings.update({ searchEngine: s })
          }
        }
      }
      const tabs = sessionTabs.length
        ? this.d.addImportedTabs(this.groupName(src.name), sessionTabs.slice(0, MAX_SESSION_TABS))
        : 0

      const state: ImportProgress['state'] = anyOk ? 'done' : locked ? 'locked' : 'failed'
      const extra = historyLocked ? { historyLocked: true } : {}
      onProgress({ ...base, state, bookmarks, history, tabs, ...extra })
      out.push({
        ...base,
        bookmarks,
        history,
        tabs,
        ...extra,
        ...(anyOk ? {} : { error: locked ? ('locked' as const) : ('failed' as const) })
      })
    }
    return { sources: out, search }
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
