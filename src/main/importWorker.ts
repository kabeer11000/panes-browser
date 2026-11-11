import { parentPort, workerData } from 'node:worker_threads'
import { copyFile, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  CHROME_EPOCH_OFFSET_MS,
  chromiumBookmarks,
  chromiumSearchUrl,
  type BrowserFamily,
  type ImportedPage
} from '@shared/importers'
import {
  chromiumSessionTabs,
  FIREFOX_SESSION_FILES,
  newestChromiumSession,
  readFirefoxSession,
  type SessionTab
} from '@shared/sessionImport'
import type { ImportItem } from '@shared/types'

/**
 * Reads one profile of another browser in a worker thread, so a large history file never stalls the window.
 * Databases are copied to a temporary folder and read from there: the browser's own files are never opened
 * for writing, and a running browser's lock shows up as a failed copy. The copies are deleted either way.
 */

export interface ImportJob {
  family: BrowserFamily
  profile: string
  items: ImportItem[]
  historyLimit: number
}

export type ImportReply =
  | {
      bookmarks: ImportedPage[]
      history: ImportedPage[]
      searchUrl: string | undefined
      tabs: SessionTab[]
      /** The history database was held by the running browser: everything else came over, history did not. */
      historyLocked?: boolean
    }
  // tabs may ride along even on a locked reply: the session file copies when the database would not
  | { error: 'locked' | 'missing' | 'failed'; detail?: string; tabs?: SessionTab[] }

class Locked extends Error {}

const missing = (err: unknown): boolean => (err as NodeJS.ErrnoException).code === 'ENOENT'

/**
 * Copy a database and its journal into `tmp`, open the copy and hand it to `read`; the copy is closed
 * whatever happens (an open one could not be deleted on Windows). `empty` when the profile has no such file.
 */
async function withCopy<T>(
  profile: string,
  name: string,
  tmp: string,
  empty: T,
  read: (db: DatabaseSync) => T
): Promise<T> {
  try {
    await copyFile(join(profile, name), join(tmp, name))
  } catch (err) {
    if (missing(err)) return empty
    throw new Locked()
  }
  for (const side of ['-wal', '-journal']) {
    await copyFile(join(profile, name + side), join(tmp, name + side)).catch((err: unknown) => {
      if (!missing(err)) throw new Locked()
    })
  }
  const db = new DatabaseSync(join(tmp, name))
  try {
    return read(db)
  } finally {
    db.close()
  }
}

const rows = (db: DatabaseSync, sql: string, ...args: number[]): ImportedPage[] =>
  db.prepare(sql).all(...args) as unknown as ImportedPage[]

/**
 * Copy one file of the profile into `tmp` and read its bytes, or null when it is not there (or held open):
 * the browser may have the session file open, so like the databases it is read through a copy, never the
 * original. `dest` is the flat name it takes in `tmp`, since the source may sit in a sub-folder.
 */
async function copyRead(
  profile: string,
  rel: string,
  tmp: string,
  dest: string
): Promise<Uint8Array | null> {
  try {
    await copyFile(join(profile, rel), join(tmp, dest))
    return await readFile(join(tmp, dest))
  } catch {
    return null
  }
}

/** The open tabs of a Chromium profile: the newest `Sessions/Session_*`, or the older `Current Session`. */
async function chromiumTabs(profile: string, tmp: string): Promise<SessionTab[]> {
  const names = await readdir(join(profile, 'Sessions')).catch(() => [] as string[])
  const newest = newestChromiumSession(names)
  const rel = newest ? join('Sessions', newest) : 'Current Session'
  const bytes = await copyRead(profile, rel, tmp, 'session')
  return bytes ? chromiumSessionTabs(bytes) : []
}

/**
 * The open tabs of a Firefox-family profile, from the first session file that is there and readable, in Firefox's
 * own order (FIREFOX_SESSION_FILES): a damaged one does not end the search.
 */
async function firefoxTabs(profile: string, tmp: string): Promise<SessionTab[]> {
  for (const rel of FIREFOX_SESSION_FILES) {
    const bytes = await copyRead(profile, join(...rel.split('/')), tmp, rel.replace(/\//g, '_'))
    const tabs = bytes && readFirefoxSession(bytes)
    if (tabs) return tabs
  }
  return []
}

async function chromium(job: ImportJob, tmp: string): Promise<ImportReply> {
  const want = (i: ImportItem): boolean => job.items.includes(i)
  const text = (name: string): Promise<string | null> =>
    readFile(join(job.profile, name), 'utf8').catch(() => null)

  // tabs, bookmarks and preferences are plain files a running browser does not lock; only the history database can
  // be held, and then the rest still comes over (the browser is usually open during onboarding)
  const tabs = want('tabs') ? await chromiumTabs(job.profile, tmp) : []
  const bookmarksFile = want('bookmarks') ? await text('Bookmarks') : null
  const prefs = want('search') ? await text('Preferences') : null
  let history: ImportedPage[] = []
  let historyLocked = false
  if (want('history')) {
    try {
      history = await withCopy(job.profile, 'History', tmp, [], (db) =>
        // divided down in SQL: microseconds since 1601 are past what a JavaScript number holds exactly
        rows(
          db,
          `SELECT url, title, last_visit_time / 1000 - ${CHROME_EPOCH_OFFSET_MS} AS time FROM urls
           WHERE hidden = 0 AND last_visit_time > 0 ORDER BY last_visit_time DESC LIMIT ?`,
          job.historyLimit
        )
      )
    } catch (err) {
      if (!(err instanceof Locked)) throw err
      historyLocked = true
    }
  }
  return {
    bookmarks: bookmarksFile ? chromiumBookmarks(bookmarksFile) : [],
    history,
    searchUrl: prefs ? chromiumSearchUrl(prefs) : undefined,
    tabs,
    ...(historyLocked ? { historyLocked } : {})
  }
}

async function firefox(job: ImportJob, tmp: string): Promise<ImportReply> {
  const want = (i: ImportItem): boolean => job.items.includes(i)
  const none = { bookmarks: [], history: [] }
  const tabs = want('tabs') ? await firefoxTabs(job.profile, tmp) : []
  try {
    const found =
      want('bookmarks') || want('history')
        ? await withCopy(job.profile, 'places.sqlite', tmp, none, (db) => ({
            bookmarks: want('bookmarks')
              ? rows(
                  db,
                  `SELECT p.url AS url, COALESCE(b.title, p.title, '') AS title, b.dateAdded / 1000 AS time
                   FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1`
                )
              : [],
            history: want('history')
              ? rows(
                  db,
                  `SELECT url, COALESCE(title, '') AS title, last_visit_date / 1000 AS time FROM moz_places
                   WHERE hidden = 0 AND last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT ?`,
                  job.historyLimit
                )
              : []
          }))
        : none
    // the search engine sits in search.json.mozlz4, a compressed format not read yet
    return { ...found, searchUrl: undefined, tabs }
  } catch (err) {
    if (err instanceof Locked) return { error: 'locked', tabs }
    throw err
  }
}

async function run(job: ImportJob): Promise<ImportReply> {
  if (
    !(await stat(job.profile).then(
      (s) => s.isDirectory(),
      () => false
    ))
  ) {
    return { error: 'missing' }
  }
  const tmp = await mkdtemp(join(tmpdir(), 'panes-import-'))
  try {
    return await (job.family === 'chromium' ? chromium(job, tmp) : firefox(job, tmp))
  } catch (err) {
    return err instanceof Locked ? { error: 'locked' } : { error: 'failed', detail: String(err) }
  } finally {
    // the copies hold the person's history: retried, as Windows can hold a just-closed file for a moment
    await rm(tmp, { recursive: true, force: true, maxRetries: 5 }).catch((err: unknown) =>
      console.error(`[import] temporary copies left in ${tmp}: ${String(err)}`)
    )
  }
}

void run(workerData as ImportJob).then((reply) => parentPort?.postMessage(reply))
