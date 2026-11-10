import { gotLock } from './singleInstance' // first: see there
import { flushTrace, mark } from './startupTrace'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, session, shell } from 'electron'
import type { CaptureKind } from '@shared/capture'
import { createServer } from 'http'
import { existsSync, statSync } from 'fs'
import { pathToFileURL } from 'url'
import type { AddressInfo } from 'net'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { DEFAULT_SETTINGS, type InternalPage } from '@shared/settings'
import { privateTabsWarning } from '@shared/update'
import { linksFromArgv } from '@shared/launch'
import type { Edge } from '@shared/layout'
import type { ClearKind, Rect, SpacePatch } from '@shared/types'
import { Adblock } from './adblock'
import { YouTube } from './youtube'
import { applyPerformance, runningMode } from './performance'
import { rewriteClientHints } from './identity'
import { DownloadManager } from './downloads'
import { BookmarkStore, HistoryStore } from './history'
import { Importer } from './importer'
import { DumpStore } from './dumps'
import { TorManager } from './tor'
import { chromeVars } from '@shared/color'
import { KIND_THEME, WELCOME_THEME } from '@shared/tabkind'
import { registerDock } from './dock'
import { registerTabCard } from './tabcard'
import { setChromeThemeSource } from './chromeTheme'
import { PasswordStore, registerPasswordIpc } from './passwords'
import {
  notifyInternalPages,
  registerInternalIpc,
  registerInternalScheme,
  serveInternalPages
} from './internal'
import icon from '../../resources/icon.png?asset'
import { PermissionManager, PermissionStore } from './permissions'
import { AskSelection } from './askSelection'
import { Reader } from './reader'
import { continueReading, habits, pickBoards, type SmartNewTab } from '@shared/newtab'
import { SitePanel } from './sitePanel'
import { PrintDialog } from './print'
import { SiteSettings, watchCertificates } from './sites'
import { SettingsStore } from './settings'
import { SpaceStore } from './spaces'
import { UpdateManager } from './updater'
import { noteLayerHealthy } from './layers'
import { Suggester } from './suggest'
import { registerAi } from './ai/ipc'
import { registerCanvas } from './ai/canvas'
import { media } from './ai/automation'
import { addFileToBoard } from './ai/canvasAssistant'
import { flushAllStores } from './store'
import { showEditMenu } from './contextMenu'
import { TabManager } from './tabs'

mark('modules') // every import above has run
applyPerformance() // Chromium's switches only count before the app is ready

/** Where links and files handed to Panes go once its window exists; until then they wait in `pending`. */
let openLinks: ((urls: string[]) => void) | null = null
const pending: string[] = []
const fromCommandLine = (argv: readonly string[]): string[] =>
  linksFromArgv(
    argv,
    (p) => pathToFileURL(p).toString(),
    (p) => {
      try {
        return existsSync(p) && statSync(p).isFile()
      } catch {
        return false
      }
    }
  )
/** Whole numbers from a value that came over IPC; anything else is dropped. */
const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.filter(Number.isInteger) : [])

const deliver = (urls: string[]): void => {
  if (urls.length === 0) return
  if (openLinks) openLinks(urls)
  else pending.push(...urls)
}

/** Whether Panes is what the system opens web links with. */
const isDefaultBrowser = (): boolean =>
  app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https')

/** Ask the system to make Panes the default; Windows will not let an app decide this alone, so show its page. */
function requestDefaultBrowser(): void {
  if (!app.isPackaged) return // a development build would register the wrong program
  app.setAsDefaultProtocolClient('http')
  app.setAsDefaultProtocolClient('https')
  if (process.platform === 'win32') {
    void shell.openExternal('ms-settings:defaultapps?registeredAppUser=Panes')
  }
}
registerInternalScheme()

/** The browser identity pages see, without the Electron and app-name tokens that make Google refuse sign-in. */
/** What the session says by default: the browser as it is, minus the app's own name (Cloudflare and others read that as noise). */
function plainUserAgent(): string {
  return app.userAgentFallback.replace(new RegExp(`\\s${app.getName()}\\/\\S+`, 'i'), '')
}

function chromeUserAgent(): string {
  return (
    app.userAgentFallback
      .replace(/\sElectron\/\S+/, '')
      .replace(new RegExp(`\\s${app.getName()}\\/\\S+`, 'i'), '')
      // Chrome shows only its major version in the user agent ("Chrome/152.0.0.0"); the rest is in client hints
      .replace(/Chrome\/(\d+)\.\d+\.\d+\.\d+/, 'Chrome/$1.0.0.0')
  )
}

// Camera/mic are allowed so video calls work; location, notifications etc. are denied until there is a prompt UI.
function createWindow(): void {
  const isMac = process.platform === 'darwin'
  mark('window-start')
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
  // The interface page is asked for now, not after everything below has been set up: its own process starts, loads
  // and runs React while this one goes on setting up. Safe because nothing the page sends (IPC) or the window emits
  // (ready-to-show, did-finish-load) is handled before this function returns, by which time every handler exists.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mark('page-requested')

  const tabSession = session.fromPartition('persist:panes')
  tabSession.setUserAgent(plainUserAgent(), 'en-US,en;q=0.9')
  rewriteClientHints(tabSession, chromeUserAgent())
  serveInternalPages(tabSession)
  // Spell check follows the system language; if that is not one it has a dictionary for, use English.
  if (tabSession.getSpellCheckerLanguages().length === 0)
    tabSession.setSpellCheckerLanguages(['en-US'])

  // Private tabs: an in-memory session (no `persist:` prefix), set up like the main one but never saving anything.
  const privateSession = session.fromPartition('private')
  privateSession.setUserAgent(plainUserAgent(), 'en-US,en;q=0.9')
  rewriteClientHints(privateSession, chromeUserAgent())
  serveInternalPages(privateSession)

  // Tor tabs: another in-memory session, whose only way out is Tor's local proxy. Until Tor is up (and after it
  // stops) the proxy points nowhere, so a Tor tab can fail but can never go out directly.
  const tor = new TorManager()
  const torSession = session.fromPartition('tor')
  torSession.setUserAgent(plainUserAgent(), 'en-US,en;q=0.9')
  rewriteClientHints(torSession, chromeUserAgent())
  serveInternalPages(torSession)
  const DEAD_PROXY = 'socks5://127.0.0.1:1'
  void torSession.setProxy({ proxyRules: DEAD_PROXY })
  tor.onChange((st) => {
    // Tor tabs waiting on Tor load only once the proxy is pointing at it.
    void torSession
      .setProxy({
        proxyRules: st.state === 'ready' ? `socks5://127.0.0.1:${tor.socksPort}` : DEAD_PROXY
      })
      .then(() => tabs.torChanged())
  })

  const settings = new SettingsStore()
  const history = new HistoryStore()
  const bookmarks = new BookmarkStore()
  const downloads = new DownloadManager(tabSession, settings)
  const passwords = new PasswordStore()
  registerPasswordIpc(win, passwords)
  const adblock = new Adblock(tabSession)
  adblock.attach(privateSession)
  adblock.configure(settings.get())
  // YouTube's in-page ad defences and options go wherever the blocker does (not into Tor tabs).
  const youtube = new YouTube(settings, adblock)
  youtube.attach(tabSession)
  youtube.attach(privateSession)
  settings.onChange((s) => {
    adblock.configure(s)
    youtube.update()
    tabs.applyDarkening()
    tabs.sweepMemory() // a stricter memory setting applies at once, not at the next sweep
    if (!win.isDestroyed()) win.webContents.send('settings:changed', s)
  })

  const spaces = new SpaceStore()
  const suggester = new Suggester({ history, bookmarks, settings })
  const dumps = new DumpStore()
  const tabs = new TabManager(win, tabSession, privateSession, {
    settings,
    history,
    bookmarks,
    spaces,
    dumps,
    tor,
    torSession,
    chromeUa: chromeUserAgent(),
    icon
  })
  const ai = registerAi({ settings, tabs, history, downloads })
  suggester.setSemantic((q, exclude) => ai.features.semantic(q, exclude))
  const canvas = registerCanvas({
    win,
    tabs,
    index: ai.index,
    router: ai.router,
    history,
    downloads,
    settings,
    content: ai.content
  })
  const permissions = new PermissionStore()
  // Popover views (site panel, permission and password cards) wear the window's colours too.
  setChromeThemeSource(() => {
    const space = spaces.get(spaces.activeId())
    const dark = nativeTheme.shouldUseDarkColors
    const accent = settings.get().accent
    const kind = tabs.activeKind()
    const theme = tabs.activeIsWelcome()
      ? WELCOME_THEME
      : kind !== 'normal'
        ? KIND_THEME[kind]
        : (space ?? { color: accent, color2: null, tint: 0 })
    return {
      scheme: dark ? 'dark' : 'light',
      vars: chromeVars(theme, dark, accent, DEFAULT_SETTINGS.accent)
    }
  })
  const permissionManager = new PermissionManager({
    win,
    anchor: () => tabs.activeRect(),
    onKeyboardLock: (wc) => tabs.markKeyboardLock(wc),
    hidden: (wc) => tabs.isHidden(wc)
  })
  permissionManager.install(tabSession, permissions)
  // Private and Tor tabs ask the same questions, but what they are told is kept in memory only, each session
  // apart, and never reaches the normal profile's saved answers.
  permissionManager.install(privateSession, new PermissionStore(false))
  permissionManager.install(torSession, new PermissionStore(false))
  for (const s of [tabSession, privateSession, torSession]) watchCertificates(s)
  const sites = new SiteSettings({
    settings,
    spaces,
    permissions: permissionManager,
    active: () => tabs.activeSite(),
    blocked: (id) => adblock.blockedOn(id),
    muteSite: (key, muted) => tabs.setSiteMuted(key, muted),
    defaultZoom: (spaceId) => tabs.defaultZoom(spaceId),
    reload: () => tabs.reload(),
    changed: () => {
      tabs.applyBoosts()
      tabs.applyZoom()
    }
  })

  // Private and Tor tabs are never saved, so Restart to update would close them for good: ask first.
  const updater = new UpdateManager(async () => {
    const warning = privateTabsWarning(tabs.privateTabCount())
    if (!warning) return true
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Restart', 'Later'],
      defaultId: 1,
      cancelId: 1,
      ...warning
    })
    return response === 0
  })
  updater.onChange((s) => {
    if (!win.isDestroyed()) win.webContents.send('ui:update', s)
  })
  updater.start()
  ipcMain.handle('update:state', () => updater.get())
  ipcMain.on('update:install', () => void updater.install())

  registerInternalIpc({
    updater,
    settings,
    permissions,
    history,
    bookmarks,
    openMany: (items) => tabs.openMany(items),
    tor: {
      status: () => tor.get(),
      start: (snowflake) => tor.start(snowflake),
      stop: () => tor.stop(),
      newTab: () => tabs.newTorTab(),
      newPrivateTab: () => void tabs.newPrivateTab()
    },
    dumps: {
      list: () => dumps.list(),
      save: (close) => tabs.dumpTabs(close),
      open: (id) => tabs.openDump(id),
      rename: (id, name) => dumps.rename(id, name),
      remove: (id) => dumps.remove(id)
    },
    downloads,
    passwords,
    importer: new Importer({ win, history, bookmarks, settings, passwords }),
    spaces: {
      list: () => spaces.list(),
      activeId: () => spaces.activeId(),
      create: () => tabs.createSpace(),
      update: (id, patch) => tabs.updateSpace(id, patch),
      remove: (id) => tabs.deleteSpace(id)
    },
    memory: { stats: () => tabs.memoryStats(), free: () => tabs.sweepMemory(true) },
    defaultBrowser: { status: isDefaultBrowser, request: requestDefaultBrowser },
    feedback: () => tabs.sendFeedback(),
    onboardingDone: () => {
      settings.update({ onboarded: true })
      tabs.closeInternal('welcome')
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
  win.webContents.on('context-menu', (_e, p) => showEditMenu(win, win.webContents, p))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Auto-hidden top bar: the page cannot see the pointer over a drag region or a native page view,
  // so the main process watches the real cursor and says when the bar should show.
  // Something over the page keeps a hover-revealed sidebar or top bar out (the pointer heading into a space editor
  // must not shut it). Neither watcher runs on the canvas board (the window shows no tabs chrome there), so the
  // overlay the board holds for its whole life never pins anything.
  const chromePinned = (): boolean => tabs.overlayOpen()
  const REVEAL_EDGE_PX = 6 // how close to the top of the window the cursor must be
  // the pointer has to rest at the edge a moment: passing over it on the way somewhere does not bring the bar out
  const REVEAL_DWELL_MS = 220
  const HIDE_DELAY_MS = 350
  let watchTimer: NodeJS.Timeout | null = null
  let peeking = false
  let outSince = 0
  let edgeSince = 0
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
      const atEdge = inside && y <= REVEAL_EDGE_PX
      if (!atEdge) edgeSince = 0
      else edgeSince ||= Date.now()
      const wanted =
        inside && (peeking ? y <= reach : atEdge && Date.now() - edgeSince >= REVEAL_DWELL_MS)
      if (wanted) {
        outSince = 0
        setPeek(true)
      } else if (peeking && chromePinned()) {
        // A space editor dropped from the bar (or anything else open over the page) keeps it out: the pointer
        // moving down into the editor must not fade the bar, and the editor inside it, away.
        outSince = 0
      } else if (peeking) {
        outSince ||= Date.now()
        if (Date.now() - outSince >= HIDE_DELAY_MS) setPeek(false)
      }
    }, 50)
  })
  win.on('closed', () => {
    if (watchTimer) clearInterval(watchTimer)
  })

  // Left-edge sidebar: like the top bar, the page cannot see the pointer over a native page view, so
  // main watches the real cursor. It asks the window to open the sidebar when the pointer rests at the
  // left edge, and to close it again (only if the pointer opened it) once the pointer has left it.
  const SIDE_EDGE_PX = 4
  const SIDE_DWELL_MS = 220 // a rest at the edge, not a pass over it on the way to something
  const SIDE_LEAVE_MS = 450
  const SIDE_REACH_PX = 28
  let sideTimer: NodeJS.Timeout | null = null
  const side = { open: true, byHover: false, widthPx: 252 }
  ipcMain.on(
    'ui:side-watch',
    (_e, enabled: boolean, open: boolean, openedByHover: boolean, widthPx: number) => {
      side.open = !!open
      side.byHover = !!openedByHover
      side.widthPx = Number(widthPx) || 252
      if (!enabled) {
        if (sideTimer) clearInterval(sideTimer)
        sideTimer = null
        return
      }
      if (sideTimer) return
      let dwellSince = 0
      let outSince = 0
      sideTimer = setInterval(() => {
        if (win.isDestroyed() || !win.isFocused() || win.isFullScreen()) {
          dwellSince = 0
          outSince = 0
          return
        }
        const p = screen.getCursorScreenPoint()
        const b = win.getContentBounds()
        const x = p.x - b.x
        const y = p.y - b.y
        const inside = x >= 0 && x <= b.width && y >= 0 && y <= b.height
        if (!side.open) {
          outSince = 0
          if (inside && x <= SIDE_EDGE_PX) {
            dwellSince ||= Date.now()
            if (Date.now() - dwellSince >= SIDE_DWELL_MS) {
              dwellSince = 0
              win.webContents.send('ui:side-hover', 'open')
            }
          } else dwellSince = 0
        } else if (side.byHover) {
          dwellSince = 0
          // A space editor (or anything else) open over the page keeps the sidebar out: the pointer wandering off
          // it, say to drag the colour wheel or look at the page, must not shut the sidebar and the editor with it.
          if (chromePinned()) outSince = 0
          else if (!inside || x > side.widthPx + SIDE_REACH_PX) {
            outSince ||= Date.now()
            if (Date.now() - outSince >= SIDE_LEAVE_MS) {
              outSince = 0
              win.webContents.send('ui:side-hover', 'close')
            }
          } else outSince = 0
        } else {
          dwellSince = 0
          outSince = 0
        }
      }, 30)
    }
  )
  win.on('closed', () => {
    if (sideTimer) clearInterval(sideTimer)
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
  ipcMain.on('tabs:new-private', () => void tabs.newPrivateTab())
  ipcMain.on('tabs:new-tor', () => tabs.newTorTab())
  ipcMain.on('tor:reconnect', (e) => {
    if (e.sender === win.webContents) void tor.start(settings.get().torSnowflake)
  })
  ipcMain.on('tabs:open-internal', (_e, page: InternalPage) => tabs.openInternal(page))
  ipcMain.on('tabs:toggle-bookmark', () => tabs.toggleBookmark())
  ipcMain.on('find:run', (_e, text: string, forward?: boolean) => tabs.find(text, forward))
  ipcMain.on('find:stop', () => tabs.stopFind())
  ipcMain.on('settings:newtab-photo', (_e, id: unknown) =>
    settings.update({ newTabPhotoId: typeof id === 'number' ? id : null })
  )
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.on('win:minimize', () => win.minimize())
  ipcMain.on('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()))
  ipcMain.on('win:close', () => win.close())
  ipcMain.on('ui:bounds', (_e, rects: Record<number, Rect>) => tabs.setRects(rects))
  ipcMain.on('tabs:split-with', (_e, id: number) => tabs.splitWith(id))
  ipcMain.on('tabs:split-many', (_e, ids: unknown) => tabs.splitMany(numbers(ids)))
  ipcMain.on('tabs:unsplit', (_e, keepId?: number) => tabs.unsplit(keepId))
  ipcMain.on('tabs:toggle-split', () => tabs.toggleSplit())
  ipcMain.on('tabs:print', () => tabs.printPage())
  ipcMain.on('tabs:action', (_e, id: unknown) => typeof id === 'string' && tabs.runAction(id))
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
  ipcMain.on('pip:toggle', () => tabs.togglePip())
  ipcMain.on('pip:exit', () => tabs.exitPip())
  ipcMain.on('tabs:close-pane', (_e, id: number) => tabs.closePane(id))
  const sitePanel = new SitePanel({ win, sites, pickElement: (done) => tabs.pickElement(done) })
  const printDialog = new PrintDialog({
    win,
    target: () => {
      const wc = tabs.activeContents()
      return wc ? { wc, persist: tabs.activeKind() === 'normal' } : null
    }
  })
  tabs.onPrint = (system) => (system ? printDialog.openSystem() : printDialog.open())
  const askSelection = new AskSelection({
    win,
    chat: ai.chat,
    host: (wc) => tabs.selectionHost(wc),
    active: () => tabs.activeContents(),
    enabled: () => {
      const info = ai.chat.info()
      return info.enabled && !!info.target && settings.get().ai.selectionAsk
    },
    continueInChat: (draft) => tabs.askAi(draft)
  })
  tabs.onAskSelection = () => askSelection.offerNow()
  const reader = new Reader({
    win,
    active: () => tabs.activeContents(),
    inCanvas: () => tabs.inCanvas(),
    normal: () => tabs.activeKind() === 'normal'
  })
  tabs.onReader = () => void reader.toggle()
  ipcMain.on('site:panel-toggle', (e, raw: unknown) => {
    const r = raw as Partial<Rect> | null
    if (e.sender !== win.webContents || !r) return
    const ok = [r.x, r.y, r.width, r.height].every(
      (n) => typeof n === 'number' && Number.isFinite(n)
    )
    if (ok) sitePanel.toggle(r as Rect)
  })
  ipcMain.handle('site:info', () => sites.info())
  ipcMain.handle('site:update', (_e, patch: unknown) => sites.update(patch))
  ipcMain.on('tabs:add-to-group', (_e, id: number, groupId: number) => tabs.addToGroup(id, groupId))
  ipcMain.on('tabs:tab-menu', (_e, id: number, picked?: unknown) =>
    tabs.tabMenu(id, numbers(picked))
  )
  ipcMain.on('tabs:group-menu', (_e, id: number) => tabs.groupMenu(id))
  ipcMain.handle('tabs:page-menu', (_e, id: unknown, x: unknown, y: unknown, live: unknown) =>
    typeof id === 'number'
      ? tabs.pageMenu(
          id,
          typeof x === 'number' ? x : undefined,
          typeof y === 'number' ? y : undefined,
          typeof live === 'boolean' ? live : undefined
        )
      : null
  )
  // the downloads bin, at the window's bottom-right corner
  const dock = registerDock(
    win,
    downloads,
    () => tabs.openInternal('downloads'),
    (path, name) => {
      if (!tabs.inCanvas()) win.webContents.send('ui:command', 'toggle-canvas')
      void addFileToBoard(path, name)
    }
  )
  tabs.onViewAdded = () => dock.raise() // page views made later would otherwise cover it
  tabs.onRefresh = () => {
    askSelection.sync() // the offer follows the page it was made for
    permissionManager.sync() // the same, and a question waiting for its tab shows once the tab is on screen
    sitePanel.refresh() // the open panel follows the tab as it navigates, loads, or starts capturing
  }
  // Answers changed or a page was told something: the open panel and any panes://settings page re-read them.
  permissionManager.onChange(() => {
    sitePanel.refresh()
    notifyInternalPages('int:perms-changed')
  })
  settings.onChange(() => sitePanel.refresh())
  ipcMain.on('app:feedback', (e) => {
    if (e.sender === win.webContents) tabs.sendFeedback()
  })
  ipcMain.on('ui:dock-hide', (e, hide: unknown) => {
    if (e.sender === win.webContents) dock.setHidden(hide === true)
  })
  registerTabCard(win, (id) => tabs.cardInfo(id))
  ipcMain.on('tabs:mute-space', (_e, id: unknown) => {
    if (typeof id === 'number') tabs.toggleSpaceMute(id)
  })
  ipcMain.on('tabs:app-menu', (_e, x: unknown, y: unknown) => {
    if (typeof x === 'number' && typeof y === 'number') tabs.appMenu(Math.round(x), Math.round(y))
  })
  ipcMain.on('tabs:group-update', (_e, id: number, patch: unknown) => tabs.updateGroup(id, patch))
  ipcMain.on('tabs:stop-capture', (_e, id: number, kinds: CaptureKind[]) =>
    tabs.stopCapture(id, kinds)
  )
  ipcMain.on('tabs:toggle-mute', (_e, id: number) => tabs.toggleMute(id))
  // play or pause what a tab plays, from its card on the board (the tab stays where it is)
  ipcMain.handle('tabs:media', async (_e, id: unknown, action: unknown) => {
    const wc = typeof id === 'number' ? tabs.contentsOf(id) : null
    if (!wc || (action !== 'toggle' && action !== 'play' && action !== 'pause')) return null
    const m = await media(wc, action, 0)
    return m ? { paused: m.paused } : null
  })
  ipcMain.on('tabs:ratios', (_e, path: number[], ratios: number[]) =>
    tabs.updateRatios(path, ratios)
  )
  ipcMain.on('tabs:move', (_e, id: number, index: number, groupId?: number | null) =>
    tabs.moveTab(id, index, groupId)
  )
  ipcMain.on('tabs:move-many', (_e, ids: unknown, index: number, groupId?: number | null) =>
    tabs.moveTabs(numbers(ids), index, groupId)
  )
  // paste (sidebar and board): copies made in a space without showing them, ids in the order asked (null: not made)
  ipcMain.handle('tabs:duplicate', (_e, ids: unknown, spaceId: unknown) =>
    typeof spaceId === 'number' ? numbers(ids).map((id) => tabs.duplicate(id, spaceId)) : []
  )
  ipcMain.handle('tabs:open-many', (_e, urls: unknown, spaceId: unknown) =>
    Array.isArray(urls) && typeof spaceId === 'number' && spaces.get(spaceId)
      ? urls
          .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
          .slice(0, 20)
          .map((u) => tabs.create(u, false, spaceId))
      : []
  )
  ipcMain.on('ui:slide', (_e, x: unknown, y: unknown) => {
    if (
      typeof x === 'number' &&
      Number.isFinite(x) &&
      typeof y === 'number' &&
      Number.isFinite(y)
    ) {
      tabs.setSlide(x, y)
    }
  })
  ipcMain.handle('ui:overlay', (_e, open: boolean, snapshot?: boolean, sharp?: boolean) =>
    tabs.setOverlay(open, snapshot, sharp === true)
  )
  ipcMain.handle('search:local', (_e, q: string) => suggester.local(String(q)))
  // the smart part of a blank tab (shared/newtab.ts): only with AI on, worked out here from history and saved boards
  ipcMain.handle('newtab:smart', (e): SmartNewTab | null => {
    if (e.sender !== win.webContents || !settings.get().ai.enabled) return null
    const now = Date.now()
    const all = history.all()
    const open = spaces.list().flatMap((s) => tabs.canvasTabs(s.id).map((t) => t.url))
    const boards = spaces.list().map((s) => {
      const st = canvas.load(s.id).state
      const things = st
        ? st.notes.length + Object.keys(st.items).length + (st.marks?.length ?? 0)
        : 0
      return { spaceId: s.id, name: s.name, color: s.color, things, usedAt: st?.usedAt }
    })
    return {
      boards: pickBoards(boards, spaces.activeId()),
      reading: continueReading(all, open, now),
      next: habits(all, open, now)
    }
  })
  ipcMain.on('newtab:open-board', (e, spaceId: unknown) => {
    if (e.sender !== win.webContents || typeof spaceId !== 'number' || !spaces.get(spaceId)) return
    if (spaceId !== spaces.activeId()) tabs.switchSpace(spaceId)
    win.webContents.send('ui:command', 'toggle-canvas')
  })
  ipcMain.handle('search:remote', (_e, q: string) => suggester.remote(String(q)))
  ipcMain.handle('search:semantic', (_e, q: unknown, exclude: unknown) =>
    suggester.semantic(
      String(q),
      Array.isArray(exclude) ? exclude.filter((u): u is string => typeof u === 'string') : []
    )
  )
  ipcMain.on('ai:warm', (e) => {
    if (e.sender === win.webContents) ai.features.warm()
  })
  ai.chat.attach(win)
  ipcMain.on('tabs:open-in-split', (_e, input: string) => tabs.openInSplit(String(input)))

  win.on('close', () => tabs.shutdown())
  win.on('ready-to-show', () => {
    mark('ready-to-show')
    win.show()
    tabs.focusActive() // showing gave the keyboard to the window's own page; the welcome tour or a restored page wants it
  })

  // On a machine running in efficient mode the interface stops animating its layout: sliding the sidebar or
  // the top bar in resizes every page view on every frame, which low-end hardware shows as a shift.
  win.webContents.on('did-finish-load', () => {
    mark('page-loaded')
    flushTrace()
    noteLayerHealthy() // the code running now works: a new app layer is not rolled back
    const fx = runningMode() === 'efficient' ? 'low' : 'full'
    void win.webContents
      // remembered too, so the next start has it before its first paint (public/boot.js)
      .executeJavaScript(
        `document.documentElement.dataset.fx = '${fx}'; try { localStorage.setItem('panes:fx', '${fx}') } catch (e) {}`
      )
      .catch(() => undefined)
  })
  mark('setup-done')
  tabs.restoreOrNew(UpdateManager.takeRestoreFlag())
  // First run: open the welcome page before anything else is shown.
  if (!settings.get().onboarded && !process.env['PANES_DEBUG']) tabs.create('panes://welcome')
  openLinks = (urls) => {
    for (const url of urls) tabs.create(url)
    if (win.isMinimized()) win.restore()
    win.focus()
  }
  deliver(fromCommandLine(process.argv.slice(1)).filter((u) => !pending.includes(u)))
  if (pending.length > 0) openLinks(pending.splice(0))
  win.on('closed', () => {
    openLinks = null
  })
  ipcMain.handle('default:status', () => isDefaultBrowser())
  ipcMain.handle('default:request', () => requestDefaultBrowser())
  ipcMain.on('default:dismiss', () => settings.update({ askDefaultBrowser: false }))
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
    if (debugPage === 'passwords') {
      const page =
        '<form id=f onsubmit="return false"><input id=u type=text name=user>' +
        '<input id=p type=password name=pass><button type=submit>Sign in</button></form>'
      const server = createServer((_req, res) => res.end(`<!doctype html>${page}`))
      server.listen(0, '127.0.0.1', async () => {
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
        const ui = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code)
        const tab = (code: string): Promise<unknown> | undefined =>
          tabs.debugContents()?.executeJavaScript(code, true)
        const say = (tag: string, v: unknown): void => console.log(`[pw] ${tag}`, JSON.stringify(v))
        await sleep(2500)
        tabs.create(origin + '/')
        await sleep(2500)
        await ui('window.__p = []; window.api.onPasswordPrompt((p) => window.__p.push(p)); 0')
        const submit = (user: string, pass: string): Promise<unknown> | undefined =>
          tab(
            `u.value = ${JSON.stringify(user)}; p.value = ${JSON.stringify(pass)}; f.requestSubmit()`
          )
        await submit('ana', 'hunter22')
        await sleep(500)
        say('prompt after first submit', await ui('window.__p'))
        await ui("window.api.answerPassword('save')")
        await sleep(300)
        say(
          'saved',
          passwords.list().map((l) => [l.origin, l.username])
        )
        flushAllStores()
        const raw = readFileSync(join(app.getPath('userData'), 'passwords.json'), 'utf8')
        say('plaintext on disk', raw.includes('hunter22'))
        await submit('ana', 'hunter22')
        await sleep(400)
        say('prompts after identical resubmit', await ui('window.__p.length'))
        await submit('ana', 'newpass99')
        await sleep(400)
        say('prompt for changed password', await ui('window.__p.at(-1)'))
        await ui("window.api.answerPassword('dismiss')")
        tabs.debugContents()?.reload()
        await sleep(2000)
        await tab('p.focus()')
        await sleep(600)
        const box = await tab(
          "(() => { const h = document.documentElement.lastElementChild; const r = h.getBoundingClientRect(); return h.style.position === 'fixed' ? { x: r.x, y: r.y } : null })()"
        )
        say('dropdown', box)
        if (box) {
          const { x, y } = box as { x: number; y: number }
          const wc = tabs.debugContents()
          wc?.sendInputEvent({ type: 'mouseMove', x: x + 20, y: y + 16 })
          wc?.sendInputEvent({
            type: 'mouseDown',
            x: x + 20,
            y: y + 16,
            button: 'left',
            clickCount: 1
          })
          wc?.sendInputEvent({
            type: 'mouseUp',
            x: x + 20,
            y: y + 16,
            button: 'left',
            clickCount: 1
          })
          await sleep(600)
          say('filled', await tab('[u.value, p.value]'))
        }
        say('cross-site credentials', passwords.credentials('http://evil.test', 1))
        app.quit()
      })
    } else if (debugPage === 'pip') {
      const url = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm'
      setTimeout(() => tabs.create(url), 2500)
      setTimeout(async () => {
        console.log('[pip] before', JSON.stringify(tabs.debugTabs()))
        tabs.togglePip()
        await new Promise((r) => setTimeout(r, 2500))
        console.log('[pip] started', JSON.stringify(await tabs.debugPip()))
        tabs.togglePip()
        await new Promise((r) => setTimeout(r, 1200))
        console.log(
          '[pip] stopped',
          JSON.stringify(await tabs.debugPip()),
          'views in main window:',
          win.contentView.children.length
        )
      }, 9000)
    } else if (debugPage === 'close') {
      setTimeout(() => tabs.create('https://example.com/'), 2500)
      setTimeout(() => tabs.create('https://example.org/'), 3000)
      setTimeout(() => {
        console.log('[close] closing window')
        app.once('quit', () => console.log('[close] app quit'))
        win.close()
      }, 7000)
    } else if (debugPage === 'restore') {
      setTimeout(
        () => console.log('[restore] after startup', JSON.stringify(tabs.debugTabs())),
        7000
      )
      setTimeout(() => tabs.activate(2), 8000)
      setTimeout(
        () => console.log('[restore] after opening tab 2', JSON.stringify(tabs.debugTabs())),
        9500
      )
    } else if (debugPage === 'popover') {
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

app.on('second-instance', (_e, argv) => {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
  deliver(fromCommandLine(argv.slice(1)))
})
// macOS hands links and files over as events, possibly before the window exists
app.on('open-url', (e, url) => {
  e.preventDefault()
  deliver(fromCommandLine([url]))
})
app.on('open-file', (e, path) => {
  e.preventDefault()
  deliver(fromCommandLine([path]))
})

if (gotLock)
  app.whenReady().then(() => {
    mark('ready')
    electronApp.setAppUserModelId('pk.procheck.panes')
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

let quitting = false
app.on('before-quit', () => {
  quitting = true
  flushAllStores()
})

// While the app quits (an update restarting it, say) late callbacks can touch windows and pages that are
// already gone. That is harmless, so it must not become an error popup. Anything else still is one.
// Panes started with its output pipe closed (a launcher or script that exits) throws EPIPE on the first console
// line, e.g. from the updater. Nothing is lost by dropping log lines nobody can read.
for (const stream of [process.stdout, process.stderr]) stream?.on('error', () => {})

process.on('uncaughtException', (err) => {
  console.error('[main] uncaught:', err)
  const message = String((err as Error)?.message ?? err)
  if (quitting || /Object has been destroyed/.test(message)) return
  dialog.showErrorBox('Panes ran into a problem', String((err as Error)?.stack ?? message))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
