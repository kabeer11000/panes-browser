import { app, shell, type DownloadItem, type Session } from 'electron'
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

export class DownloadManager {
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

    item.on('updated', (_e, state) => {
      info.received = item.getReceivedBytes()
      info.total = item.getTotalBytes()
      info.state =
        state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
    })
    item.once('done', (_e, state) => {
      info.received = item.getReceivedBytes()
      info.state =
        state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      this.live.delete(info.id)
      this.store.save()
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
      this.store.save()
    }
  }

  clear(): void {
    this.store.value.items = this.store.value.items.filter((d) => this.live.has(d.id))
    this.store.save()
  }
}
