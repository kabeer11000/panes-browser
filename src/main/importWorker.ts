import { parentPort, workerData } from 'node:worker_threads'
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
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
  | { bookmarks: ImportedPage[]; history: ImportedPage[]; searchUrl: string | undefined }
  | { error: 'locked' | 'missing' | 'failed'; detail?: string }

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

async function chromium(job: ImportJob, tmp: string): Promise<ImportReply> {
  const want = (i: ImportItem): boolean => job.items.includes(i)
  const text = (name: string): Promise<string | null> =>
    readFile(join(job.profile, name), 'utf8').catch(() => null)

  const bookmarksFile = want('bookmarks') ? await text('Bookmarks') : null
  const prefs = want('search') ? await text('Preferences') : null
  const history = want('history')
    ? await withCopy(job.profile, 'History', tmp, [], (db) =>
        // divided down in SQL: microseconds since 1601 are past what a JavaScript number holds exactly
        rows(
          db,
          `SELECT url, title, last_visit_time / 1000 - ${CHROME_EPOCH_OFFSET_MS} AS time FROM urls
           WHERE hidden = 0 AND last_visit_time > 0 ORDER BY last_visit_time DESC LIMIT ?`,
          job.historyLimit
        )
      )
    : []
  return {
    bookmarks: bookmarksFile ? chromiumBookmarks(bookmarksFile) : [],
    history,
    searchUrl: prefs ? chromiumSearchUrl(prefs) : undefined
  }
}

async function firefox(job: ImportJob, tmp: string): Promise<ImportReply> {
  const want = (i: ImportItem): boolean => job.items.includes(i)
  const none = { bookmarks: [], history: [] }
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
  return { ...found, searchUrl: undefined }
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
