import { app, BrowserWindow, ipcMain, screen, session } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { InternalPage } from '../shared/settings'
import type { Edge } from '../shared/layout'
import type { ClearKind, Rect, SpacePatch } from '../shared/types'
import { Adblock } from './adblock'
import { DownloadManager } from './downloads'
import { BookmarkStore, HistoryStore } from './history'
import { registerInternalIpc, registerInternalScheme, serveInternalPages } from './internal'
import icon from '../../resources/icon.png?asset'
import { SettingsStore } from './settings'
import { SpaceStore } from './spaces'
import { Suggester } from './suggest'
import { flushAllStores } from './store'
import { TabManager } from './tabs'

if (process.env['PANES_USERDATA']) app.setPath('userData', process.env['PANES_USERDATA'])

registerInternalScheme()

/** The browser identity pages see, without the Electron and app-name tokens that make Google refuse sign-in. */
function chromeUserAgent(): string {
  return app.userAgentFallback
    .replace(/\sElectron\/\S+/, '')
    .replace(new RegExp(`\\s${app.getName()}\\/\\S+`, 'i'), '')
}

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
    icon,
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
  tabSession.setUserAgent(chromeUserAgent())
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

  const spaces = new SpaceStore()
  const suggester = new Suggester({ history, bookmarks, settings })
  const tabs = new TabManager(win, tabSession, { settings, history, bookmarks, spaces })

  registerInternalIpc({
    settings,
    history,
    bookmarks,
    downloads,
    spaces: {
      list: () => spaces.list(),
      activeId: () => spaces.activeId(),
      create: () => tabs.createSpace(),
      update: (id, patch) => tabs.updateSpace(id, patch),
      remove: (id) => tabs.deleteSpace(id)
    },
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

  // Auto-hidden top bar: the page cannot see the pointer over a drag region or a native page view,
  // so the main process watches the real cursor and says when the bar should show.
  const REVEAL_EDGE_PX = 6 // how close to the top of the window the cursor must be
  const HIDE_DELAY_MS = 350
  let watchTimer: NodeJS.Timeout | null = null
  let peeking = false
  let outSince = 0
  const setPeek = (show: boolean): void => {
    if (show === peeking || win.isDestroyed()) return
    peeking = show
    win.webContents.send('ui:peek-bar', show)
  }
  ipcMain.on('ui:bar-watch', (_e, enabled: boolean, barPx: number) => {
    const reach = (Number(barPx) || 36) + 10 // stay revealed while the cursor is over the bar itself
    if (!enabled) {
      if (watchTimer) clearInterval(watchTimer)
      watchTimer = null
      setPeek(false)
      return
    }
    if (watchTimer) return
    watchTimer = setInterval(() => {
      if (win.isDestroyed() || !win.isFocused()) return setPeek(false)
      const p = screen.getCursorScreenPoint()
      const b = win.getContentBounds()
      const y = p.y - b.y
      const inside = p.x >= b.x && p.x <= b.x + b.width && y >= 0 && y <= b.height
      const wanted = inside && (y <= REVEAL_EDGE_PX || (peeking && y <= reach))
      if (wanted) {
        outSince = 0
        setPeek(true)
      } else if (peeking) {
        outSince ||= Date.now()
        if (Date.now() - outSince >= HIDE_DELAY_MS) setPeek(false)
      }
    }, 50)
  })
  win.on('closed', () => {
    if (watchTimer) clearInterval(watchTimer)
  })

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
  ipcMain.on('tabs:pop-out', (_e, id: number) => tabs.popOut(id))
  ipcMain.on('spaces:switch', (_e, id: number) => tabs.switchSpace(id))
  ipcMain.on('spaces:create', () => tabs.createSpace())
  ipcMain.on('spaces:update', (_e, id: number, patch: SpacePatch) => tabs.updateSpace(id, patch))
  ipcMain.on('spaces:delete', (_e, id: number) => tabs.deleteSpace(id))
  ipcMain.on('spaces:move-tab', (_e, tabId: number, spaceId: number) =>
    tabs.moveTabToSpace(tabId, spaceId)
  )
  ipcMain.on('tabs:close-pane', (_e, id: number) => tabs.closePane(id))
  ipcMain.on('tabs:ratios', (_e, path: number[], ratios: number[]) =>
    tabs.updateRatios(path, ratios)
  )
  ipcMain.on('tabs:move', (_e, id: number, index: number) => tabs.moveTab(id, index))
  ipcMain.handle('ui:overlay', (_e, open: boolean, snapshot?: boolean) =>
    tabs.setOverlay(open, snapshot)
  )
  ipcMain.handle('search:local', (_e, q: string) => suggester.local(String(q)))
  ipcMain.handle('search:remote', (_e, q: string) => suggester.remote(String(q)))
  ipcMain.on('tabs:open-in-split', (_e, input: string) => tabs.openInSplit(String(input)))

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
    if (debugPage === 'popover') {
      setTimeout(() => tabs.openInternal('history'), 2500)
      setTimeout(() => win.webContents.send('ui:command', 'focus-address'), 9000)
      setTimeout(async () => {
        const out = await win.webContents.executeJavaScript(`(() => {
          const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] }
          const bar = [...document.querySelectorAll('.address')].find((e) => e.getBoundingClientRect().height > 0)
          const b = bar && bar.getBoundingClientRect()
          const pt = b ? document.elementsFromPoint(b.x + 40, b.y + b.height / 2).map((e) => e.className || e.tagName).slice(0, 8) : []
          const pal = document.querySelector('.pal')
          const cs = pal ? getComputedStyle(pal) : null
          return JSON.stringify({
            bar: r(bar), pal: r(pal), input: r(document.querySelector('.pal-input')), inputEl: r(document.querySelector('.pal-input input')),
            list: r(document.querySelector('.pal-list')), rows: [...document.querySelectorAll('.pal-row')].slice(0, 3).map(r),
            stackAtBar: pt, palBg: cs && cs.backgroundColor, palOpacity: cs && cs.opacity, palPos: cs && cs.position,
            inputValue: document.querySelector('.pal-input input')?.value, win: [innerWidth, innerHeight]
          })
        })()`)
        console.log('[popover]', out)
      }, 11000)
    } else if (debugPage === 'dnd') {
      setTimeout(() => {
        tabs.openInternal('history')
        tabs.openInternal('bookmarks')
        tabs.openInternal('settings')
      }, 2000)
      setTimeout(() => {
        tabs.activate(2)
        tabs.splitWith(3)
      }, 7000)
      setTimeout(async () => {
        const q = (sel: string): string =>
          `(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height} })()`
        console.log(
          '[dnd] dom',
          await win.webContents.executeJavaScript(
            'JSON.stringify({ids: [...document.querySelectorAll(".tab-row[data-tab-id]")].map((e) => e.dataset.tabId), panes: [...document.querySelectorAll(".pane")].map((e) => e.dataset.tabId)})'
          )
        )
        const row = await win.webContents.executeJavaScript(q('.tab-row[data-tab-id="4"]'))
        const pane = await win.webContents.executeJavaScript(q('.pane[data-tab-id="3"]'))
        console.log('[dnd] row', JSON.stringify(row), 'pane', JSON.stringify(pane))
        if (!row || !pane) return
        const rx = Math.round(row.x + row.w / 2)
        const ry = Math.round(row.y + row.h / 2)
        const wc = win.webContents
        wc.sendInputEvent({ type: 'mouseDown', x: rx, y: ry, button: 'left', clickCount: 1 })
        const tx = Math.round(pane.x + pane.w - 24)
        const ty = Math.round(pane.y + pane.h / 2)
        for (let i = 1; i <= 10; i++) {
          wc.sendInputEvent({
            type: 'mouseMove',
            x: Math.round(rx + ((tx - rx) * i) / 10),
            y: Math.round(ry + ((ty - ry) * i) / 10),
            modifiers: ['leftbuttondown']
          })
          await new Promise((r) => setTimeout(r, 40))
        }
        await new Promise((r) => setTimeout(r, 700))
        console.log(
          '[dnd] mid',
          await wc.executeJavaScript(
            `JSON.stringify({ panes: document.querySelector('.panes')?.getBoundingClientRect().width, stage: document.querySelector('.stage')?.getBoundingClientRect().width, wrap: document.querySelector('.stage-wrap')?.getBoundingClientRect().width, win: innerWidth, scrollW: document.documentElement.scrollWidth, items: [...document.querySelectorAll('.pane')].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.tabId, Math.round(r.x), Math.round(r.width)] }) })`
          )
        )
        wc.sendInputEvent({ type: 'mouseUp', x: tx, y: ty, button: 'left', clickCount: 1 })
        await new Promise((r) => setTimeout(r, 900))
        const after = await wc.capturePage()
        writeFileSync(join(app.getAppPath(), '.debug-dnd-after.png'), after.toPNG())
      }, 10500)
    } else if (debugPage === 'picker') {
      setTimeout(() => tabs.openInternal('settings'), 2000)
      setTimeout(() => void tabs.debugPicker(), 6000)
    } else if (debugPage === 'overlays') {
      setTimeout(() => {
        tabs.openInternal('history')
        tabs.openInternal('bookmarks')
        tabs.openInternal('settings')
        tabs.create('https://example.com')
      }, 2000)
      setTimeout(() => win.webContents.send('ui:command', 'toggle-taskview'), 6000)
      setTimeout(() => void tabs.debugShot(join(app.getAppPath(), '.debug-grid.png')), 7500)
      setTimeout(() => win.webContents.send('ui:command', 'toggle-taskview'), 8500)
      setTimeout(() => win.webContents.send('ui:stack-wheel', 160), 10000)
      setTimeout(() => void tabs.debugShot(join(app.getAppPath(), '.debug-stackview.png')), 11500)
    } else if (debugPage === 'stack') {
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
