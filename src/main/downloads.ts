import { app, nativeImage, shell, type DownloadItem, type Session } from 'electron'
import { existsSync, renameSync, statSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { DownloadAction, DownloadInfo } from '@shared/types'
import { PAGE_SCRIPT, type PageHints } from '@shared/ai/evidence'
import type { SettingsStore } from './settings'
import { JsonStore } from './store'

/** "name (1).ext" style de-duplication so a download never overwrites an existing file. */
function uniquePath(dir: string, filename: string): string {
  const ext = extname(filename)
  const stem = basename(filename, ext)
  let candidate = join(dir, filename)
  for (let n = 1; existsSync(candidate); n++) candidate = join(dir, `${stem} (${n})${ext}`)
  return candidate
}

/** "name (2).ext": the first free name for a file renamed into a folder (the original file's own name is not counted). */
function freeName(dir: string, filename: string): string {
  const ext = extname(filename)
  const stem = basename(filename, ext)
  let candidate = join(dir, filename)
  for (let n = 2; existsSync(candidate); n++) candidate = join(dir, `${stem} (${n})${ext}`)
  return candidate
}

/** The page a download was started from, remembered while it runs. */
export interface DownloadPage {
  title: string
  url: string
  /** What the page says about the link that was clicked (og:title, h1, description, link text), read as the download started. */
  hints?: Promise<PageHints | null>
  mime?: string
}

/** Hints from the page a download was started on; null when the page is gone or does not answer. */
function readHints(wc: Electron.WebContents): Promise<PageHints | null> {
  if (wc.isDestroyed()) return Promise.resolve(null)
  return wc.executeJavaScript(PAGE_SCRIPT).catch(() => null)
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const CHANGE_MS = 250 // how often progress is passed on while bytes arrive

const THUMB = 160
const SHOWN = 8 // downloads the bin can show: only these are given pictures
const PAGE_SHOWN = 40 // and the most the downloads page asks for at a time

/**
 * A small picture of a finished file. An image is shrunk; anything else is asked for from the system's own
 * thumbnail cache (a film's frame, a document's first page) where there is one, which costs next to nothing;
 * failing that, the icon the system shows for the file.
 */
async function previewFor(path: string): Promise<string | null> {
  try {
    if (IMAGE_EXT.has(extname(path).toLowerCase())) {
      const img = nativeImage.createFromPath(path)
      if (!img.isEmpty()) return img.resize({ width: THUMB }).toDataURL()
    } else if (process.platform !== 'linux') {
      try {
        const thumb = await nativeImage.createThumbnailFromPath(path, {
          width: THUMB,
          height: THUMB
        })
        if (!thumb.isEmpty()) return thumb.toDataURL()
      } catch {
        // no thumbnail for this kind of file: its icon will do
      }
    }
    return (await app.getFileIcon(path, { size: 'large' })).toDataURL()
  } catch {
    return null
  }
}

export class DownloadManager {
  private previews = new Map<number, string>()
  private asked = new Set<number>()
  private changeListeners: Array<() => void> = []
  private startListeners: Array<(info: DownloadInfo) => void> = []
  private doneListeners: Array<(info: DownloadInfo, page: DownloadPage | undefined) => void> = []
  private pages = new Map<number, DownloadPage>()
  private changeTimer: ReturnType<typeof setTimeout> | null = null

  private store = new JsonStore<{ nextId: number; items: DownloadInfo[] }>('downloads', {
    nextId: 1,
    items: []
  })
  private live = new Map<number, DownloadItem>()

  constructor(
    private session: Session,
    private settings: SettingsStore
  ) {
    // Anything that was mid-download when the app closed will not resume.
    for (const d of this.store.value.items) {
      if (d.state === 'progressing' || d.state === 'paused') d.state = 'interrupted'
    }
    session.on('will-download', (_e, item, wc) =>
      this.track(item, {
        title: wc?.getTitle() ?? '',
        url: wc?.getURL() ?? '',
        mime: item.getMimeType(),
        hints: wc && this.wantHints() ? readHints(wc) : undefined
      })
    )
  }

  /** Set by the AI features: whether to read the page's hints when a download starts. */
  wantHints: () => boolean = () => false

  list(): DownloadInfo[] {
    return this.store.value.items
  }

  /** The list as the downloads bin shows it: with a preview for each finished file (kept in memory, never saved). */
  view(): DownloadInfo[] {
    this.fetchPreviews()
    return this.store.value.items.map((d, i) => {
      const preview = this.previews.get(d.id)
      // only the rows the bin shows are checked, so a long list costs nothing
      const missing = i < SHOWN && d.state === 'completed' && !existsSync(d.savePath)
      return preview || missing
        ? { ...d, ...(preview && { preview }), ...(missing && { missing }) }
        : d
    })
  }

  /** What a drag out of the bin carries: the file and its picture, or null when either is not there. */
  dragItem(id: number): { file: string; icon: Electron.NativeImage } | null {
    const d = this.store.value.items.find((x) => x.id === id)
    const preview = this.previews.get(id)
    if (!d || d.state !== 'completed' || !preview || !existsSync(d.savePath)) return null
    const icon = nativeImage.createFromDataURL(preview).resize({ width: 64 })
    return icon.isEmpty() ? null : { file: d.savePath, icon }
  }

  /** Downloads from earlier sessions get their pictures the first time they are asked for: the ones the bin shows. */
  private fetchPreviews(): void {
    this.makePreviews(this.store.value.items.slice(0, SHOWN).map((d) => d.id))
  }

  private makePreviews(ids: number[]): void {
    for (const id of ids) {
      const d = this.store.value.items.find((x) => x.id === id)
      if (!d || d.state !== 'completed' || this.previews.has(id) || this.asked.has(id)) continue
      if (!existsSync(d.savePath)) continue
      this.asked.add(id)
      void previewFor(d.savePath).then((preview) => {
        if (!preview) return
        this.previews.set(id, preview)
        this.changed()
      })
    }
  }

  /** The pictures there are so far for these downloads (those not made yet are started, and asked for again later). */
  previewsFor(ids: number[]): Record<number, string> {
    const wanted = ids.slice(0, PAGE_SHOWN)
    this.makePreviews(wanted)
    const out: Record<number, string> = {}
    for (const id of wanted) {
      const p = this.previews.get(id)
      if (p) out[id] = p
    }
    return out
  }

  onChange(l: () => void): void {
    this.changeListeners.push(l)
  }

  onStart(l: (info: DownloadInfo) => void): void {
    this.startListeners.push(l)
  }

  /** Called when a download has finished (completed only), with the page it came from. */
  onComplete(l: (info: DownloadInfo, page: DownloadPage | undefined) => void): void {
    this.doneListeners.push(l)
  }

  /** A better name for a finished download, offered in the downloads page. Nothing on disk changes. */
  suggestName(id: number, name: string): void {
    const info = this.store.value.items.find((d) => d.id === id)
    if (!info || info.state !== 'completed' || name === info.filename) return
    info.suggestedName = name
    this.store.save()
    this.changed(true)
  }

  /** Carry out the offered rename on disk. A name taken in that folder gets " (2)". */
  private acceptName(info: DownloadInfo): void {
    const name = info.suggestedName
    delete info.suggestedName
    if (!name || info.state !== 'completed' || !existsSync(info.savePath)) return
    const target = freeName(dirname(info.savePath), name)
    try {
      renameSync(info.savePath, target)
    } catch (err) {
      console.warn('[downloads] rename failed:', err instanceof Error ? err.message : err)
      return
    }
    info.savePath = target
    info.filename = basename(target)
    this.store.save()
  }

  private changed(now = false): void {
    if (now) {
      if (this.changeTimer) clearTimeout(this.changeTimer)
      this.changeTimer = null
      for (const l of this.changeListeners) l()
    } else if (!this.changeTimer) {
      this.changeTimer = setTimeout(() => this.changed(true), CHANGE_MS)
    }
  }

  /** Where a new download goes: the folder picked in settings, or the system's Downloads if that one has gone. */
  private folder(): string {
    const { downloadDir } = this.settings.get()
    return downloadDir && existsSync(downloadDir) ? downloadDir : app.getPath('downloads')
  }

  /** A free path for `filename` in the download folder ("name (2).png" when it is taken). */
  pathFor(filename: string): string {
    return uniquePath(this.folder(), filename)
  }

  /**
   * A file Panes wrote itself (a board export), listed like a finished download: on the shelf, in panes://downloads,
   * and flying to the bin.
   */
  record(savePath: string): void {
    let size: number
    try {
      size = statSync(savePath).size
    } catch {
      return // nothing was written
    }
    const d = this.store.value
    const info: DownloadInfo = {
      id: d.nextId++,
      filename: basename(savePath),
      url: '',
      savePath,
      total: size,
      received: size,
      state: 'completed',
      time: Date.now()
    }
    d.items.unshift(info)
    for (const l of this.startListeners) l(info)
    this.store.save()
    this.changed(true)
    void previewFor(savePath).then((preview) => {
      if (!preview) return
      this.previews.set(info.id, preview)
      this.changed(true)
    })
  }

  private track(item: DownloadItem, page: DownloadPage): void {
    const { downloadAsk } = this.settings.get()
    const suggested = uniquePath(this.folder(), item.getFilename())
    if (!downloadAsk) {
      item.setSavePath(suggested)
      this.begin(item, page)
      return
    }
    // Not setting a path makes Electron ask with the system's Save As dialog. Nothing is listed (and nothing flies to
    // the bin) until a place is chosen: progress events arrive while the dialog is still open, so the chosen path is
    // what says it has been answered. Cancelling the dialog ends the download with no path, and leaves no trace.
    item.setSaveDialogOptions({ defaultPath: suggested })
    let began = false
    const onProgress = (): void => {
      if (began || !item.getSavePath()) return
      began = true
      item.off('updated', onProgress)
      this.begin(item, page)
    }
    item.on('updated', onProgress)
    item.once('done', (_e, state) => {
      if (began || !item.getSavePath()) return
      this.finish(this.begin(item, page), item, state) // finished before any progress was seen (a tiny file)
    })
  }

  private begin(item: DownloadItem, page: DownloadPage): DownloadInfo {
    const d = this.store.value
    const savePath = item.getSavePath()
    const info: DownloadInfo = {
      id: d.nextId++,
      filename: basename(savePath),
      url: item.getURL(),
      savePath,
      total: item.getTotalBytes(),
      received: 0,
      state: 'progressing',
      time: Date.now()
    }
    d.items.unshift(info)
    this.live.set(info.id, item)
    this.pages.set(info.id, page)
    for (const l of this.startListeners) l(info)
    this.changed(true)

    item.on('updated', (_e, state) => {
      info.received = item.getReceivedBytes()
      info.total = item.getTotalBytes()
      info.state =
        state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
      this.changed()
    })
    item.once('done', (_e, state) => this.finish(info, item, state))
    this.store.save()
    return info
  }

  private finish(info: DownloadInfo, item: DownloadItem, state: string): void {
    info.received = item.getReceivedBytes()
    info.state =
      state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
    this.live.delete(info.id)
    this.store.save()
    this.changed(true)
    const page = this.pages.get(info.id)
    this.pages.delete(info.id)
    if (info.state === 'completed') {
      for (const l of this.doneListeners) l(info, page)
      this.asked.add(info.id)
      void previewFor(info.savePath).then((preview) => {
        if (!preview) return
        this.previews.set(info.id, preview)
        this.changed(true)
      })
    }
  }

  act(id: number, action: DownloadAction): void {
    const info = this.store.value.items.find((d) => d.id === id)
    if (!info) return
    const item = this.live.get(id)
    if (action === 'accept-name') {
      this.acceptName(info)
      this.changed(true)
    } else if (action === 'dismiss-name') {
      delete info.suggestedName
      this.store.save()
      this.changed(true)
    } else if (action === 'open') void shell.openPath(info.savePath)
    else if (action === 'show') shell.showItemInFolder(info.savePath)
    else if (action === 'cancel') item?.cancel()
    else if (action === 'pause') item?.pause()
    else if (action === 'resume' && item?.canResume()) item.resume()
    else if (action === 'retry') {
      if (item?.canResume()) item.resume()
      else {
        this.act(id, 'remove')
        this.session.downloadURL(info.url)
      }
    } else if (action === 'remove') {
      item?.cancel()
      this.store.value.items = this.store.value.items.filter((d) => d.id !== id)
      this.previews.delete(id)
      this.store.save()
      this.changed(true)
    }
  }

  clear(): void {
    this.store.value.items = this.store.value.items.filter((d) => this.live.has(d.id))
    this.previews.clear()
    this.store.save()
    this.changed(true)
  }
}
