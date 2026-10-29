import { ipcMain, net, protocol, type IpcMainInvokeEvent, type Session } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'
import { INTERNAL_PAGES } from '../shared/settings'
import type { ClearKind, DownloadAction, Space, SpacePatch } from '../shared/types'
import type { DownloadManager } from './downloads'
import type { BookmarkStore, HistoryStore } from './history'
import type { SettingsStore } from './settings'

/** Must run before app is ready. */
export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'panes', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/** panes://<page> serves the internal renderer entry; other paths are its assets. */
export function serveInternalPages(session: Session): void {
  const root = join(__dirname, '../renderer')
  session.protocol.handle('panes', (req) => {
    const url = new URL(req.url)
    if (!(INTERNAL_PAGES as readonly string[]).includes(url.hostname)) {
      return new Response('Not found', { status: 404 })
    }
    const rel = url.pathname === '/' || url.pathname === '' ? '/internal.html' : url.pathname
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && dev) return net.fetch(dev + rel + url.search) // keep ?import and friends, or Vite serves raw files instead of modules
    const file = normalize(join(root, rel))
    if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

interface Deps {
  settings: SettingsStore
  history: HistoryStore
  bookmarks: BookmarkStore
  downloads: DownloadManager
  spaces: {
    list: () => Space[]
    activeId: () => number
    create: () => Space
    update: (id: number, patch: SpacePatch) => void
    remove: (id: number) => void
  }
  clearBrowsingData: (kinds: ClearKind[], sinceMs: number | null) => Promise<void>
}

/** IPC for panes:// pages. Every handler refuses callers that are not on the panes:// scheme. */
export function registerInternalIpc(d: Deps): void {
  const handle = <A extends unknown[], R>(
    channel: string,
    fn: (...args: A) => R | Promise<R>
  ): void => {
    ipcMain.handle(channel, (e: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!e.senderFrame?.url.startsWith('panes://')) throw new Error('forbidden')
      return fn(...(args as A))
    })
  }

  handle('int:history-list', (q: string, limit: number, offset: number) =>
    d.history.list(String(q), Math.min(500, Number(limit) || 100), Math.max(0, Number(offset) || 0))
  )
  handle('int:history-remove', (id: number) => d.history.remove(id))
  handle('int:bookmarks-list', () => d.bookmarks.list())
  handle('int:bookmark-remove', (id: number) => d.bookmarks.remove(id))
  handle('int:downloads-list', () => d.downloads.list())
  handle('int:download-action', (id: number, action: DownloadAction) => d.downloads.act(id, action))
  // panes:// pages follow the active space's light or dark mode
  handle('int:settings-get', () => ({
    ...d.settings.get(),
    scheme: d.spaces.list().find((sp) => sp.id === d.spaces.activeId())?.mode ?? 'dark'
  }))
  handle('int:settings-set', (patch: object) => d.settings.update(patch))
  handle('int:spaces-list', () => d.spaces.list())
  handle('int:space-create', () => d.spaces.create())
  handle('int:space-update', (id: number, patch: SpacePatch) => d.spaces.update(id, patch))
  handle('int:space-delete', (id: number) => d.spaces.remove(id))
  handle('int:clear-data', (kinds: ClearKind[], sinceMs: number | null) =>
    d.clearBrowsingData(kinds, sinceMs)
  )
}
