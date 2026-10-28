import { app, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { InternalPage } from '../shared/settings'
import type { Edge } from '../shared/layout'
import type { ClearKind, Rect } from '../shared/types'
import { Adblock } from './adblock'
import { DownloadManager } from './downloads'
import { BookmarkStore, HistoryStore } from './history'
import { registerInternalIpc, registerInternalScheme, serveInternalPages } from './internal'
import { SettingsStore } from './settings'
import { flushAllStores } from './store'
import { TabManager } from './tabs'

registerInternalScheme()

// Camera/mic are allowed so video calls work; location, notifications etc. are denied until there is a prompt UI.
const ALLOWED_PERMISSIONS = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'keyboardLock',
  'media',
  'mediaKeySystem'
])

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#00000000',
    backgroundMaterial: 'mica',
    ...(isMac
      ? {
          titleBarStyle: 'hidden' as const,
          vibrancy: 'under-window' as const,
          trafficLightPosition: { x: 16, y: 14 }
        }
      : { frame: false }),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
  })

  const tabSession = session.fromPartition('persist:panes')
  tabSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(ALLOWED_PERMISSIONS.has(permission))
  )
  serveInternalPages(tabSession)

  const settings = new SettingsStore()
  const history = new HistoryStore()
  const bookmarks = new BookmarkStore()
  const downloads = new DownloadManager(tabSession)
  const adblock = new Adblock(tabSession)
  void adblock.set(settings.get().adblock)
  settings.onChange((s) => {
    void adblock.set(s.adblock)
    if (!win.isDestroyed()) win.webContents.send('settings:changed', s)
  })

  const tabs = new TabManager(win, tabSession, { settings, history, bookmarks })

  registerInternalIpc({
    settings,
    history,
    bookmarks,
    downloads,
    clearBrowsingData: async (kinds: ClearKind[], sinceMs: number | null) => {
      if (kinds.includes('history')) history.clear(sinceMs)
      if (kinds.includes('downloads')) downloads.clear()
      if (kinds.includes('cookies')) {
        await tabSession.clearStorageData({
          storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
        })
      }
      if (kinds.includes('cache')) await tabSession.clearCache()
    }
  })

  win.webContents.on('before-input-event', (e, input) => tabs.handleKey(e, input))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  ipcMain.handle('tabs:get', () => tabs.initialData())
  ipcMain.on('tabs:create', (_e, input?: string) => tabs.create(input))
  ipcMain.on('tabs:close', (_e, id: number) => tabs.close(id))
  ipcMain.on('tabs:activate', (_e, id: number) => tabs.activate(id))
  ipcMain.on('tabs:navigate', (_e, input: string) => tabs.navigate(input))
  ipcMain.on('tabs:back', () => tabs.back())
  ipcMain.on('tabs:forward', () => tabs.forward())
  ipcMain.on('tabs:reload', () => tabs.reload())
  ipcMain.on('tabs:stop', () => tabs.stop())
  ipcMain.on('tabs:open-internal', (_e, page: InternalPage) => tabs.openInternal(page))
  ipcMain.on('tabs:toggle-bookmark', () => tabs.toggleBookmark())
  ipcMain.on('find:run', (_e, text: string, forward?: boolean) => tabs.find(text, forward))
  ipcMain.on('find:stop', () => tabs.stopFind())
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.on('win:minimize', () => win.minimize())
  ipcMain.on('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()))
  ipcMain.on('win:close', () => win.close())
  ipcMain.on('ui:bounds', (_e, rects: Record<number, Rect>) => tabs.setRects(rects))
  ipcMain.on('tabs:split-with', (_e, id: number) => tabs.splitWith(id))
  ipcMain.on('tabs:unsplit', (_e, keepId?: number) => tabs.unsplit(keepId))
  ipcMain.on('tabs:toggle-split', () => tabs.toggleSplit())
  ipcMain.on('tabs:drop', (_e, id: number, targetId: number, edge: Edge | 'center') =>
    tabs.dropTab(id, targetId, edge)
  )
  ipcMain.on('tabs:close-pane', (_e, id: number) => tabs.closePane(id))
  ipcMain.on('tabs:ratios', (_e, path: number[], ratios: number[]) =>
    tabs.updateRatios(path, ratios)
  )
  ipcMain.on('tabs:move', (_e, id: number, index: number) => tabs.moveTab(id, index))
  ipcMain.handle('ui:overlay', (_e, open: boolean) => tabs.setOverlay(open))

  win.on('ready-to-show', () => win.show())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  tabs.restoreOrNew()
  const debugPage = process.env['PANES_DEBUG']
  if (debugPage) {
    win.webContents.on('console-message', (e) =>
      console.log('[ui console]', e.message, e.sourceId + ':' + e.lineNumber)
    )
    win.webContents.on('preload-error', (_e, path, err) =>
      console.log('[ui preload-error]', path, err)
    )
  }
  if (debugPage) {
    if (debugPage === 'stack') {
      setTimeout(() => {
        tabs.openInternal('history')
        tabs.openInternal('bookmarks')
        tabs.openInternal('settings')
      }, 2000)
      setTimeout(() => {
        tabs.activate(2)
        tabs.splitWith(3)
        tabs.dropTab(4, 3, 'bottom')
      }, 3500)
      setTimeout(() => win.webContents.send('ui:stack-wheel', 160), 5000)
      setTimeout(() => void tabs.debugShot(join(app.getAppPath(), '.debug-stack.png')), 6500)
      setTimeout(() => win.webContents.send('ui:stack-release'), 7000)
    } else if (debugPage === 'layout') {
      setTimeout(() => {
        tabs.openInternal('history')
        tabs.openInternal('bookmarks')
        tabs.openInternal('settings')
      }, 2000)
      setTimeout(() => {
        tabs.activate(2)
        tabs.splitWith(3)
        tabs.dropTab(4, 3, 'bottom')
      }, 3500)
    } else {
      setTimeout(() => tabs.openInternal(debugPage as InternalPage), 2500)
    }
    setTimeout(() => void tabs.debugShot(join(app.getAppPath(), '.debug-shot.png')), 7500)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('pk.procheck.panes')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', flushAllStores)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
