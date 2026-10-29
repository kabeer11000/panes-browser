import { app, ipcMain, net, protocol, shell, type IpcMainInvokeEvent, type Session } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'
import { INTERNAL_PAGES } from '../shared/settings'
import { normalizeOrigin } from '../shared/passwords'
import type {
  ClearKind,
  DownloadAction,
  LoginInput,
  MemoryStats,
  Space,
  SpacePatch
} from '../shared/types'
import type { TabDump } from '../shared/dumps'
import type { DownloadManager } from './downloads'
import type { BookmarkStore, HistoryStore } from './history'
import { newPassword, type PasswordStore } from './passwords'
import type { PermKind } from '../shared/permissions'
import type { PermissionStore } from './permissions'
import { flushAllStores } from './store'
import type { SettingsStore } from './settings'
import type { UpdateManager } from './updater'

/** Must run before app is ready. */
export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'panes', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

const STANDALONE: Record<string, string> = { error: '/error.html', welcome: '/welcome.html' }

/** panes://<page> serves the internal renderer entry; other paths are its assets. */
export function serveInternalPages(session: Session): void {
  const root = join(__dirname, '../renderer')
  session.protocol.handle('panes', (req) => {
    const url = new URL(req.url)
    // panes://error (a failed load) and panes://welcome (first run) have entries of their own, not the settings shell
    const own = STANDALONE[url.hostname]
    if (!own && !(INTERNAL_PAGES as readonly string[]).includes(url.hostname)) {
      return new Response('Not found', { status: 404 })
    }
    const entry = own ?? '/internal.html'
    const rel = url.pathname === '/' || url.pathname === '' ? entry : url.pathname
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && dev) return net.fetch(dev + rel + url.search) // keep ?import and friends, or Vite serves raw files instead of modules
    const file = normalize(join(root, rel))
    if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

interface Deps {
  updater: UpdateManager
  settings: SettingsStore
  permissions: PermissionStore
  history: HistoryStore
  bookmarks: BookmarkStore
  dumps: {
    list: () => TabDump[]
    save: (close: boolean) => TabDump | null
    open: (id: number) => void
    rename: (id: number, name: unknown) => void
    remove: (id: number) => void
  }
  downloads: DownloadManager
  passwords: PasswordStore
  spaces: {
    list: () => Space[]
    activeId: () => number
    create: () => Space
    update: (id: number, patch: SpacePatch) => void
    remove: (id: number) => void
  }
  memory: { stats: () => MemoryStats; free: () => number }
  onboardingDone: () => void
  defaultBrowser: { status: () => boolean; request: () => void }
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

  handle('int:update-state', () => d.updater.get())
  handle('int:update-check', () => d.updater.check())
  handle('int:update-install', () => d.updater.install())
  handle('int:about', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch
  }))
  handle('int:history-list', (q: string, limit: number, offset: number) =>
    d.history.list(String(q), Math.min(500, Number(limit) || 100), Math.max(0, Number(offset) || 0))
  )
  handle('int:history-remove', (id: number) => d.history.remove(id))
  handle('int:history-remove-many', (ids: number[]) =>
    d.history.removeMany(Array.isArray(ids) ? ids.filter((i) => Number.isInteger(i)) : [])
  )
  handle('int:bookmarks-list', () => d.bookmarks.list())
  handle('int:bookmark-remove', (id: number) => d.bookmarks.remove(id))
  handle('int:touchpad-settings', () => shell.openExternal('ms-settings:devices-touchpad'))
  handle('int:dumps-list', () => d.dumps.list())
  handle('int:dump-save', (close: unknown) => d.dumps.save(close === true))
  handle('int:dump-open', (id: number) => d.dumps.open(Number(id)))
  handle('int:dump-rename', (id: number, name: unknown) => d.dumps.rename(Number(id), name))
  handle('int:dump-remove', (id: number) => d.dumps.remove(Number(id)))
  handle('int:downloads-list', () => d.downloads.list())
  handle('int:download-action', (id: number, action: DownloadAction) => d.downloads.act(id, action))
  // panes:// pages follow the active space: its light or dark mode, and its colour for highlights
  handle('int:settings-get', () => {
    const space = d.spaces.list().find((sp) => sp.id === d.spaces.activeId())
    return {
      ...d.settings.get(),
      scheme: space?.mode ?? 'system',
      spaceColor: space?.color ?? null,
      spaceTint: space?.tint ?? 0
    }
  })
  handle('int:perms-list', () => d.permissions.list())
  handle('int:perm-remove', (origin: string, kind: PermKind) =>
    d.permissions.remove(String(origin), kind)
  )
  handle('int:perms-reset', () => d.permissions.reset())
  handle('int:memory-stats', () => d.memory.stats())
  handle('int:memory-free', () => d.memory.free())
  handle('int:default-status', () => d.defaultBrowser.status())
  handle('int:default-request', () => d.defaultBrowser.request())
  handle('int:onboarding-done', () => d.onboardingDone())
  handle('int:restart', () => {
    flushAllStores() // exit() skips before-quit, and writes are delayed: save what was just chosen
    app.relaunch()
    app.exit(0)
  })
  handle('int:settings-set', (patch: object) => d.settings.update(patch))
  handle('int:spaces-list', () => d.spaces.list())
  handle('int:space-create', () => d.spaces.create())
  handle('int:space-update', (id: number, patch: SpacePatch) => d.spaces.update(id, patch))
  handle('int:space-delete', (id: number) => d.spaces.remove(id))
  handle('int:passwords-list', () => d.passwords.list())
  handle('int:password-reveal', (id: number) => d.passwords.password(id))
  handle('int:password-save', (login: LoginInput) => {
    const origin = normalizeOrigin(String(login.origin))
    return origin
      ? d.passwords.upsert(origin, String(login.username), String(login.password)) !== null
      : false
  })
  handle('int:password-edit', (id: number, username: string, password: string) =>
    d.passwords.edit(id, String(username), String(password))
  )
  handle('int:password-remove', (id: number) => d.passwords.remove(id))
  handle('int:passwords-import', (csv: string) => d.passwords.importCsv(String(csv)))
  handle('int:passwords-export', () => d.passwords.exportCsv())
  handle('int:password-generate', () => newPassword())
  handle('int:clear-data', (kinds: ClearKind[], sinceMs: number | null) =>
    d.clearBrowsingData(kinds, sinceMs)
  )
}
