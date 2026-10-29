import { app, nativeImage, shell, type DownloadItem, type Session } from 'electron'
import { existsSync } from 'fs'
import { basename, extname, join } from 'path'
import type { DownloadAction, DownloadInfo } from '../shared/types'
import { JsonStore } from './store'

/** "name (1).ext" style de-duplication so a download never overwrites an existing file. */
function uniquePath(dir: string, filename: string): string {
  const ext = extname(filename)
  const stem = basename(filename, ext)
  let candidate = join(dir, filename)
  for (let n = 1; existsSync(candidate); n++) candidate = join(dir, `${stem} (${n})${ext}`)
  return candidate
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
  private changeTimer: ReturnType<typeof setTimeout> | null = null

  private store = new JsonStore<{ nextId: number; items: DownloadInfo[] }>('downloads', {
    nextId: 1,
    items: []
  })
  private live = new Map<number, DownloadItem>()

  constructor(session: Session) {
    // Anything that was mid-download when the app closed will not resume.
    for (const d of this.store.value.items) {
      if (d.state === 'progressing' || d.state === 'paused') d.state = 'interrupted'
    }
    session.on('will-download', (_e, item) => this.track(item))
  }

  list(): DownloadInfo[] {
    return this.store.value.items
  }

  /** The list as the downloads bin shows it: with a preview for each finished file (kept in memory, never saved). */
  view(): DownloadInfo[] {
    this.fetchPreviews()
    return this.store.value.items.map((d) => {
      const preview = this.previews.get(d.id)
      return preview ? { ...d, preview } : d
    })
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

  private changed(now = false): void {
    if (now) {
      if (this.changeTimer) clearTimeout(this.changeTimer)
      this.changeTimer = null
      for (const l of this.changeListeners) l()
    } else if (!this.changeTimer) {
      this.changeTimer = setTimeout(() => this.changed(true), CHANGE_MS)
    }
  }

  private track(item: DownloadItem): void {
    const d = this.store.value
    const savePath = uniquePath(app.getPath('downloads'), item.getFilename())
    item.setSavePath(savePath)
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
    for (const l of this.startListeners) l(info)
    this.changed(true)

    item.on('updated', (_e, state) => {
      info.received = item.getReceivedBytes()
      info.total = item.getTotalBytes()
      info.state =
        state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
      this.changed()
    })
    item.once('done', (_e, state) => {
      info.received = item.getReceivedBytes()
      info.state =
        state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      this.live.delete(info.id)
      this.store.save()
      this.changed(true)
      if (info.state === 'completed') {
        this.asked.add(info.id)
        void previewFor(info.savePath).then((preview) => {
          if (!preview) return
          this.previews.set(info.id, preview)
          this.changed(true)
        })
      }
    })
    this.store.save()
  }

  act(id: number, action: DownloadAction): void {
    const info = this.store.value.items.find((d) => d.id === id)
    if (!info) return
    const item = this.live.get(id)
    if (action === 'open') void shell.openPath(info.savePath)
    else if (action === 'show') shell.showItemInFolder(info.savePath)
    else if (action === 'cancel') item?.cancel()
    else if (action === 'pause') item?.pause()
    else if (action === 'resume' && item?.canResume()) item.resume()
    else if (action === 'remove') {
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
