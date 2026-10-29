import {
  BrowserWindow,
  shell,
  WebContentsView,
  type Event,
  type Input,
  type MouseWheelInputEvent,
  type Session,
  type WebContents
} from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { internalUrl, type InternalPage } from '../shared/settings'
import {
  applyDrop,
  insertTab,
  leaf,
  leaves,
  normalizeLayout,
  removeTab,
  ROOT_TARGET,
  setRatios,
  type Edge,
  type LayoutNode
} from '../shared/layout'
import type { InitialData, Rect, SpacePatch, TabInfo, TabsState, UiCommand } from '../shared/types'
import { resolveInput } from '../shared/url'
import { showContextMenu } from './contextMenu'
import type { BookmarkStore, HistoryStore } from './history'
import type { SettingsStore } from './settings'
import type { SpaceStore } from './spaces'
import { JsonStore } from './store'

const THUMB_WIDTH = 800
const THUMB_INTERVAL_MS = 4000
const SNAPSHOT_TIMEOUT_MS = 350 // overlays open without waiting longer than this for snapshots
const VIEW_RADIUS = 12
const ZOOM_STEP = 0.5
const ZOOM_MIN = -3
const ZOOM_MAX = 5
const OPEN_EXTERNALLY = new Set(['mailto:', 'tel:'])

interface Tab {
  view: WebContentsView
  favicon: string | null
  thumb: string | null
  thumbTimer: NodeJS.Timeout | null
  /** Created with a URL, so it is loading rather than blank even while getURL() is still empty. */
  hasUrl: boolean
  spaceId: number
}

/** The tab's live WebContents, or null while it is being torn down (reading it then would throw). */
function liveContents(tab: Tab): WebContents | null {
  const wc = tab.view.webContents as WebContents | undefined
  return wc && !wc.isDestroyed() ? wc : null
}

export class TabManager {
  private tabs = new Map<number, Tab>() // insertion order is display order
  private activeId: number | null = null
  private nextId = 1
  private layout: LayoutNode | null = null
  /** Spaces: the active one owns `activeId` and `layout`; the others keep theirs here while hidden. */
  private activeSpaceId = 0
  private layouts = new Map<number, LayoutNode | null>()
  private lastActive = new Map<number, number | null>()
  private rects: Record<number, Rect> = {}
  private overlay = false
  private closedUrls: string[] = []

  private fullscreenId: number | null = null
  private lastFind = ''
  private sessionStore = new JsonStore<{
    tabs: Array<{ url: string; spaceId: number }>
    active: number
  }>('session-v2', { tabs: [], active: 0 })
  private sessionTimer: NodeJS.Timeout | null = null

  constructor(
    private win: BrowserWindow,
    private session: Session,
    private deps: {
      settings: SettingsStore
      history: HistoryStore
      bookmarks: BookmarkStore
      spaces: SpaceStore
    }
  ) {
    this.activeSpaceId = deps.spaces.activeId()
    win.on('resize', () => this.applyVisibility())
    setInterval(() => {
      if (this.win.isFocused()) for (const id of this.visibleIds()) void this.snapshot(id)
    }, THUMB_INTERVAL_MS).unref()
  }

  // ---- queries ----

  initialData(): InitialData {
    const thumbs: Record<number, string> = {}
    for (const [id, t] of this.tabs) if (t.thumb) thumbs[id] = t.thumb
    return { state: this.state(), thumbs }
  }

  private state(): TabsState {
    const tabs: TabInfo[] = []
    for (const [id, t] of this.tabs) {
      if (t.spaceId !== this.activeSpaceId) continue
      const wc = liveContents(t)
      if (!wc) continue
      tabs.push({
        id,
        url: wc.getURL(),
        title: wc.getTitle(),
        favicon: t.favicon,
        loading: wc.isLoading(),
        bookmarked: this.deps.bookmarks.has(wc.getURL()),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward()
      })
    }
    return {
      tabs,
      activeId: this.activeId,
      layout: this.layout,
      spaces: this.deps.spaces.list(),
      activeSpaceId: this.activeSpaceId
    }
  }

  /** Ids of the active space's tabs, in display order. */
  private own(): number[] {
    return [...this.tabs].filter(([, t]) => t.spaceId === this.activeSpaceId).map(([id]) => id)
  }

  private current(): Tab | null {
    return this.activeId === null ? null : (this.tabs.get(this.activeId) ?? null)
  }

  /** Tabs whose views are on screen: the whole tiled group when the active tab is in one, else just the active tab. */
  private visibleIds(): number[] {
    if (this.activeId === null) return []
    const group = this.layout ? leaves(this.layout) : []
    return group.includes(this.activeId) ? group : [this.activeId]
  }

  private isBlank(tab: Tab): boolean {
    const wc = liveContents(tab)
    return !wc || (!tab.hasUrl && wc.getURL() === '')
  }

  // ---- tab lifecycle ----

  create(input = '', activate = true, spaceId = this.activeSpaceId): number {
    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        sandbox: true,
        preload: join(__dirname, '../preload/internal.js')
      }
    })
    view.setBorderRadius(VIEW_RADIUS)
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)
    this.win.contentView.addChildView(view)

    const id = this.nextId++
    const tab: Tab = {
      view,
      favicon: null,
      thumb: null,
      thumbTimer: null,
      hasUrl: false,
      spaceId
    }
    this.tabs.set(id, tab)
    this.wire(id, tab)

    const url = resolveInput(input, this.deps.settings.searchUrl())
    if (url) {
      tab.hasUrl = true
      view.webContents.loadURL(url).catch(() => {}) // ERR_ABORTED on redirects is normal
    }
    if (activate) this.activate(id)
    else this.refresh()
    return id
  }

  activate(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (tab.spaceId !== this.activeSpaceId) this.enterSpace(tab.spaceId)
    this.activeId = id
    this.refresh()
    if (this.isBlank(tab)) {
      this.win.webContents.focus()
      this.command('focus-address')
    } else if (!this.overlay) {
      tab.view.webContents.focus()
    }
  }

  close(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    const url = liveContents(tab)?.getURL()
    if (url) this.closedUrls.push(url)

    if (this.layout) this.setLayout(removeTab(this.layout, id))
    const ids = this.own()
    const idx = ids.indexOf(id)
    if (tab.thumbTimer) clearTimeout(tab.thumbTimer)
    this.tabs.delete(id)
    this.win.contentView.removeChildView(tab.view)
    tab.view.webContents.close()

    if (this.activeId !== id) return this.refresh()
    this.activeId = null
    const next = ids[idx + 1] ?? ids[idx - 1]
    if (next !== undefined) this.activate(next)
    else this.create() // never leave the window tab-less
  }

  reopenClosed(): void {
    const url = this.closedUrls.pop()
    if (url) this.create(url)
  }

  step(delta: 1 | -1): void {
    const ids = this.own()
    if (ids.length < 2 || this.activeId === null) return
    const i = ids.indexOf(this.activeId)
    this.activate(ids[(i + delta + ids.length) % ids.length])
  }

  private activateIndex(i: number): void {
    const ids = this.own()
    const id = i === 8 ? ids[ids.length - 1] : ids[i] // Ctrl+9 jumps to the last tab
    if (id !== undefined) this.activate(id)
  }

  /** Open saved tabs when the user chose to restore, otherwise a fresh blank tab. */
  restoreOrNew(): void {
    const saved = this.sessionStore.value
    const known = new Set(this.deps.spaces.list().map((sp) => sp.id))
    if (this.deps.settings.get().startup === 'restore' && saved.tabs.length > 0) {
      const ids = saved.tabs.map((t) =>
        this.create(t.url, false, known.has(t.spaceId) ? t.spaceId : this.activeSpaceId)
      )
      const own = ids.filter((id) => this.tabs.get(id)?.spaceId === this.activeSpaceId)
      const pick = ids[Math.min(saved.active, ids.length - 1)]
      this.activate(own.includes(pick) ? pick : (own[0] ?? this.create()))
    } else {
      this.create()
    }
  }

  private persistSession(): void {
    if (this.sessionTimer) return
    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = null
      const tabs: Array<{ url: string; spaceId: number }> = []
      let active = 0
      for (const [id, t] of this.tabs) {
        const url = liveContents(t)?.getURL() ?? ''
        if (!/^(https?|file):/i.test(url)) continue
        if (id === this.activeId) active = tabs.length
        tabs.push({ url, spaceId: t.spaceId })
      }
      this.sessionStore.value = { tabs, active }
      this.sessionStore.save()
    }, 1500)
  }

  // ---- spaces ----

  /** Park the current space's layout and active tab, then make `id` the active space (no tab activation). */
  private enterSpace(id: number): void {
    this.layouts.set(this.activeSpaceId, this.layout)
    this.lastActive.set(this.activeSpaceId, this.activeId)
    this.activeSpaceId = id
    this.deps.spaces.setActive(id)
    this.layout = this.layouts.get(id) ?? null
    const own = this.own()
    const remembered = this.lastActive.get(id)
    this.activeId = remembered != null && own.includes(remembered) ? remembered : (own[0] ?? null)
  }

  switchSpace(id: number): void {
    if (id === this.activeSpaceId || !this.deps.spaces.get(id)) return
    this.enterSpace(id)
    if (this.activeId === null) this.create()
    else this.activate(this.activeId)
  }

  /** Make a new space and switch to it. */
  createSpace(): ReturnType<SpaceStore['add']> {
    const space = this.deps.spaces.add()
    this.switchSpace(space.id)
    return space
  }

  updateSpace(id: number, patch: SpacePatch): void {
    this.deps.spaces.update(id, patch)
    this.refresh()
  }

  /** Delete a space and close every tab in it. The last space cannot be deleted. */
  deleteSpace(id: number): void {
    const list = this.deps.spaces.list()
    if (list.length <= 1 || !this.deps.spaces.get(id)) return
    if (id === this.activeSpaceId) {
      this.switchSpace((list.find((sp) => sp.id !== id) as { id: number }).id)
    }
    for (const [tid, t] of [...this.tabs]) {
      if (t.spaceId !== id) continue
      if (t.thumbTimer) clearTimeout(t.thumbTimer)
      this.tabs.delete(tid)
      this.win.contentView.removeChildView(t.view)
      t.view.webContents.close()
    }
    this.layouts.delete(id)
    this.lastActive.delete(id)
    this.deps.spaces.remove(id)
    this.refresh()
  }

  /** Move a tab to another space (it leaves any split it was in). */
  moveTabToSpace(tabId: number, spaceId: number): void {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.spaceId === spaceId || !this.deps.spaces.get(spaceId)) return
    const wasActive = this.activeId === tabId
    if (this.layout) this.setLayout(removeTab(this.layout, tabId))
    tab.spaceId = spaceId
    if (wasActive) {
      this.activeId = null
      const next = this.own()[0]
      if (next !== undefined) this.activate(next)
      else this.create()
    } else {
      this.refresh()
    }
  }

  /** Dev aid: save a PNG of the active tab so layout problems can be inspected without a screen. */
  async debugShot(file: string): Promise<void> {
    const cur = this.current()
    console.log(
      '[debug] active',
      this.activeId,
      'url',
      cur?.view.webContents.getURL(),
      'bounds',
      JSON.stringify(cur?.view.getBounds()),
      'visible',
      cur?.view.getVisible(),
      'rects',
      JSON.stringify(this.rects),
      'overlay',
      this.overlay
    )
    const img = await cur?.view.webContents.capturePage()
    if (img) writeFileSync(file, img.toPNG())
    const ui = await this.win.webContents.capturePage()
    writeFileSync(file.replace('.png', '-ui.png'), ui.toPNG())
  }

  /** Dev aid: drag the theme picker's wheel with real mouse events and report whether the space changed. */
  async debugPicker(): Promise<void> {
    const wc = this.current()?.view.webContents
    if (!wc) return console.log('[picker] no tab')
    const spaces = (): Promise<string> =>
      wc.executeJavaScript('window.panesInternal.spacesList().then((l) => JSON.stringify(l[0]))')
    console.log('[picker] before', await spaces())
    const rect = JSON.parse(
      await wc.executeJavaScript(
        "(() => { const el = document.querySelector('.tp-wheel'); el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}) })()"
      )
    )
    const cx = Math.round(rect.x + rect.w / 2)
    const cy = Math.round(rect.y + rect.h / 2)
    const at = (dx: number, dy: number): { x: number; y: number } => ({ x: cx + dx, y: cy + dy })
    wc.sendInputEvent({ type: 'mouseDown', ...at(60, 0), button: 'left', clickCount: 1 })
    for (const [dx, dy] of [
      [55, 10],
      [40, 40],
      [0, 60],
      [-40, 40]
    ]) {
      wc.sendInputEvent({ type: 'mouseMove', ...at(dx, dy), modifiers: ['leftbuttondown'] })
      await new Promise((r) => setTimeout(r, 40))
    }
    wc.sendInputEvent({ type: 'mouseUp', ...at(-40, 40), button: 'left', clickCount: 1 })
    await new Promise((r) => setTimeout(r, 500))
    console.log('[picker] after ', await spaces())
  }

  // ---- navigation ----

  /** Focus the tab already showing this internal page, or open it in a new tab. */
  openInternal(page: InternalPage): void {
    const url = internalUrl(page)
    for (const [id, t] of this.tabs) {
      if (t.spaceId === this.activeSpaceId && liveContents(t)?.getURL().startsWith(url)) {
        return this.activate(id)
      }
    }
    this.create(url)
  }

  toggleBookmark(): void {
    const tab = this.current()
    if (!tab) return
    const wc = tab.view.webContents
    if (!/^https?:/i.test(wc.getURL())) return
    this.deps.bookmarks.toggle(wc.getURL(), wc.getTitle(), tab.favicon)
    this.refresh()
  }

  find(text: string, forward = true): void {
    const wc = this.current()?.view.webContents
    if (!wc) return
    if (!text) return this.stopFind()
    const isNew = text !== this.lastFind
    this.lastFind = text
    wc.findInPage(text, isNew ? {} : { forward, findNext: true })
  }

  stopFind(): void {
    this.lastFind = ''
    this.current()?.view.webContents.stopFindInPage('clearSelection')
  }

  private zoom(delta: number | null): void {
    const wc = this.current()?.view.webContents
    if (!wc) return
    const next = delta === null ? 0 : wc.getZoomLevel() + delta
    wc.setZoomLevel(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)))
  }

  private setFullscreen(id: number | null): void {
    this.fullscreenId = id
    this.win.setFullScreen(id !== null)
    this.applyVisibility()
  }

  navigate(input: string): void {
    const url = resolveInput(input, this.deps.settings.searchUrl())
    if (!url) return
    const tab = this.current()
    if (!tab) {
      this.create(url)
      return
    }
    tab.hasUrl = true
    tab.view.webContents.loadURL(url).catch(() => {})
    tab.view.webContents.focus()
    this.refresh()
  }

  back(): void {
    this.current()?.view.webContents.navigationHistory.goBack()
  }
  forward(): void {
    this.current()?.view.webContents.navigationHistory.goForward()
  }
  reload(): void {
    this.current()?.view.webContents.reload()
  }
  stop(): void {
    this.current()?.view.webContents.stop()
  }

  // ---- split view (tiling layout) ----

  /** Single place the layout changes: drops degenerate layouts and keeps a group contiguous in the tab list. */
  private setLayout(next: LayoutNode | null): void {
    this.layout = normalizeLayout(next)
    const group = this.layout ? leaves(this.layout) : []
    if (group.length < 2) return
    const ids = [...this.tabs.keys()]
    const first = Math.min(...group.map((g) => ids.indexOf(g)))
    const rest = ids.filter((i) => !group.includes(i))
    const at = ids.slice(0, first).filter((i) => !group.includes(i)).length
    const ordered = [...rest.slice(0, at), ...group, ...rest.slice(at)]
    this.tabs = new Map(ordered.map((i) => [i, this.tabs.get(i)!]))
  }

  private layoutWith(targetId: number): LayoutNode {
    return this.layout && leaves(this.layout).includes(targetId) ? this.layout : leaf(targetId)
  }

  /** Open id beside the active tab (to its right). */
  splitWith(id: number): void {
    if (this.activeId === null || id === this.activeId || !this.tabs.has(id)) return
    const base = this.layoutWith(this.activeId)
    this.setLayout(leaves(base).includes(id) ? base : insertTab(base, this.activeId, id, 'right'))
    this.activate(id)
  }

  /** Dissolve the whole group; every tab stays open. */
  unsplit(keepId?: number): void {
    this.setLayout(null)
    if (keepId !== undefined && this.tabs.has(keepId)) this.activate(keepId)
    else this.refresh()
  }

  /** Take one pane out of the group (the tab stays open). */
  closePane(id: number): void {
    if (!this.layout) return
    const group = leaves(this.layout)
    this.setLayout(removeTab(this.layout, id))
    const rest = group.filter((g) => g !== id)
    if (this.activeId === id && rest.length > 0) this.activate(rest[0])
    else this.refresh()
  }

  /** Take a pane out of the group and show it on its own, full size. */
  popOut(id: number): void {
    if (!this.layout || !this.tabs.has(id)) return
    this.setLayout(removeTab(this.layout, id))
    this.activate(id)
  }

  /** Load an address or search in a new tab and tile it beside the current one. */
  openInSplit(input: string): void {
    const base = this.activeId
    const id = this.create(input, false)
    if (base !== null) {
      this.activate(base)
      this.splitWith(id)
    }
  }

  toggleSplit(): void {
    if (this.activeId === null) return
    if (this.visibleIds().length > 1) return this.unsplit(this.activeId)
    const ids = this.own()
    const partner =
      ids.length > 1 ? ids[(ids.indexOf(this.activeId) + 1) % ids.length] : this.create('', false)
    this.splitWith(partner)
  }

  /**
   * Drop a tab (from the sidebar or another pane) on an edge of the pane showing targetId.
   * Edges tile it beside that pane; centre swaps with it or replaces it.
   */
  dropTab(id: number, targetId: number, edge: Edge | 'center'): void {
    if (!this.tabs.has(id) || (targetId !== ROOT_TARGET && !this.tabs.has(targetId))) return
    // The target may belong to a group other than the active one (dragging in the overview).
    const next = applyDrop(this.layout, id, targetId, edge)
    if (next === this.layout) return
    this.setLayout(next)
    this.activate(id)
  }

  /** Move the focused pane one step in a direction by swapping with its nearest neighbour there. */
  movePane(dir: Edge): void {
    const id = this.activeId
    const me = id === null ? undefined : this.rects[id]
    if (id === null || !me || this.visibleIds().length < 2) return
    const cx = me.x + me.width / 2
    const cy = me.y + me.height / 2
    let best: number | null = null
    let bestDist = Infinity
    for (const other of this.visibleIds()) {
      const r = this.rects[other]
      if (other === id || !r) continue
      const dx = r.x + r.width / 2 - cx
      const dy = r.y + r.height / 2 - cy
      const ahead = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'top' ? -dy : dy
      if (ahead <= 0) continue
      const dist = ahead + (dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)) * 2
      if (dist < bestDist) {
        best = other
        bestDist = dist
      }
    }
    if (best !== null) this.dropTab(id, best, 'center')
  }

  updateRatios(path: number[], ratios: number[]): void {
    if (!this.layout) return
    this.layout = setRatios(this.layout, path, ratios)
    this.refresh()
  }

  /** Reorder a tab in the sidebar. A tab in a group moves its whole group with it. */
  moveTab(id: number, index: number): void {
    if (!this.tabs.has(id)) return
    const group = this.layout && leaves(this.layout).includes(id) ? leaves(this.layout) : [id]
    const own = this.own()
    const rest = own.filter((i) => !group.includes(i))
    const removedBefore = group.filter((g) => own.indexOf(g) < index).length
    const at = Math.max(0, Math.min(rest.length, index - removedBefore))
    rest.splice(at, 0, ...group)
    // Write the new order back into the slots this space's tabs occupy in the global order.
    const global = [...this.tabs.keys()]
    let k = 0
    for (let i = 0; i < global.length; i++) if (own.includes(global[i])) global[i] = rest[k++]
    this.tabs = new Map(global.map((i) => [i, this.tabs.get(i)!]))
    this.setLayout(this.layout) // a loose tab dropped inside a group gets pushed out of it
    this.refresh()
  }

  /** A click inside a split pane moves focus (and the address bar) to that pane's tab. */
  private focusPane(id: number): void {
    if (this.overlay || this.activeId === id || !this.visibleIds().includes(id)) return
    this.activeId = id
    this.refresh()
  }

  // ---- layout / overlay ----

  setRects(rects: Record<number, Rect>): void {
    const next: Record<number, Rect> = {}
    for (const [id, r] of Object.entries(rects)) {
      next[Number(id)] = {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.max(0, Math.round(r.width)),
        height: Math.max(0, Math.round(r.height))
      }
    }
    this.rects = next
    this.applyVisibility()
  }

  async setOverlay(open: boolean, snapshot = true): Promise<void> {
    if (open && snapshot) {
      const snaps = Promise.all(this.visibleIds().map((id) => this.snapshot(id)))
      await Promise.race([
        snaps,
        new Promise((resolve) => setTimeout(resolve, SNAPSHOT_TIMEOUT_MS))
      ])
    }
    this.overlay = open
    this.refresh()
    const cur = this.current()
    if (open) this.win.webContents.focus()
    else if (cur && !this.isBlank(cur)) cur.view.webContents.focus()
  }

  /** Show the visible tabs' views (none while a UI overlay is open); blank tabs show renderer UI instead. */
  private applyVisibility(): void {
    const shown = this.overlay ? [] : this.visibleIds()
    const [w, h] = this.win.getContentSize()
    for (const [id, tab] of this.tabs) {
      const normal = shown.includes(id) ? (this.rects[id] ?? null) : null
      // HTML5 fullscreen (video etc.) takes the whole window for that tab only.
      const rect =
        this.fullscreenId !== null
          ? id === this.fullscreenId
            ? { x: 0, y: 0, width: w, height: h }
            : null
          : normal
      const show = rect !== null && !this.isBlank(tab)
      if (show) tab.view.setBounds(rect)
      tab.view.setVisible(show)
    }
  }

  // ---- events ----

  private wire(id: number, tab: Tab): void {
    const wc = tab.view.webContents
    const refresh = (): void => this.refresh()

    if (process.env['PANES_DEBUG']) {
      wc.on('console-message', (e) =>
        console.log('[tab console]', e.message, e.sourceId + ':' + e.lineNumber)
      )
      wc.on('did-fail-load', (_e, code, desc, url) =>
        console.log('[tab fail-load]', code, desc, url)
      )
      wc.on('render-process-gone', (_e, d) => console.log('[tab gone]', d.reason))
      wc.on('preload-error', (_e, path, err) => console.log('[tab preload-error]', path, err))
    }
    wc.on('did-start-loading', refresh)
    wc.on('did-navigate', () => {
      this.deps.history.add(wc.getURL(), wc.getTitle())
      this.lastFind = ''
      refresh()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) this.deps.history.add(url, wc.getTitle())
      refresh()
    })
    wc.on('page-title-updated', (_e, title) => {
      this.deps.history.updateMeta(wc.getURL(), { title })
      refresh()
    })
    wc.on('found-in-page', (_e, r) => {
      if (id === this.activeId) {
        this.send('ui:find-result', { active: r.activeMatchOrdinal, matches: r.matches })
      }
    })
    wc.on('context-menu', (_e, params) =>
      showContextMenu(this.win, wc, params, {
        openTab: (u) => this.create(u),
        openSplit: (u) => {
          const base = this.activeId
          const nid = this.create(u, false)
          if (base !== null) {
            this.activate(base)
            this.splitWith(nid)
          }
        },
        searchUrl: (t) => this.deps.settings.searchUrl() + encodeURIComponent(t)
      })
    )
    wc.on('enter-html-full-screen', () => this.setFullscreen(id))
    wc.on('leave-html-full-screen', () => this.setFullscreen(null))
    wc.on('did-stop-loading', () => {
      this.refresh()
      this.scheduleSnapshot(id)
    })
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) tab.favicon = null
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? null
      this.deps.history.updateMeta(wc.getURL(), { favicon: tab.favicon })
      this.refresh()
    })
    wc.on('before-input-event', (e, input) => this.handleKey(e, input))
    wc.on('focus', () => this.focusPane(id))
    // Ctrl+wheel over a page drives the tab stack (page zoom is not wired up, so nothing fights it).
    wc.on('input-event', (_e, ev) => {
      if (ev.type === 'mouseDown') this.focusPane(id)
      if (ev.type !== 'mouseWheel') return
      if (!ev.modifiers?.some((m) => m === 'control' || m === 'ctrl')) return
      const { wheelTicksY = 0, deltaY = 0 } = ev as MouseWheelInputEvent
      // Chromium's wheel delta is positive for scroll-up; the renderer expects DOM units (down is positive).
      this.send('ui:stack-wheel', wheelTicksY !== 0 ? -wheelTicksY * 100 : -deltaY)
    })
    wc.setWindowOpenHandler(({ url, features, disposition }) => {
      // Sign-in flows (Google, Figma, ...) open a popup and message the page that opened it, so a
      // real popup window must stay linked to its opener. Ordinary links still become tabs.
      if (disposition === 'new-window' || /\b(width|height|popup)\b/i.test(features)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            backgroundColor: '#ffffff',
            webPreferences: { session: this.session, sandbox: true }
          }
        }
      }
      this.openLink(url)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (e, url) => {
      if (this.externalScheme(url)) {
        e.preventDefault()
        this.openLink(url)
      }
    })
  }

  private externalScheme(url: string): boolean {
    try {
      return OPEN_EXTERNALLY.has(new URL(url).protocol)
    } catch {
      return false
    }
  }

  /** mailto:/tel: go to the OS; everything else becomes a tab. */
  private openLink(url: string): void {
    if (this.externalScheme(url)) void shell.openExternal(url)
    else this.create(url)
  }

  /** Browser shortcuts. Registered on every tab and the UI window so they work wherever focus is. */
  handleKey(event: Event, input: Input): void {
    if (input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Meta')) {
      this.send('ui:stack-release')
      return
    }
    if (input.type !== 'keyDown') return
    const mod = input.control || input.meta
    const k = input.key.toLowerCase()
    let handled = true

    if (mod && !input.alt && !input.shift) {
      if (k === 't') this.create()
      else if (k === 'w' && this.activeId !== null) this.close(this.activeId)
      else if (k === 'l') this.command('focus-address')
      else if (k === 'r') this.reload()
      else if (k === 'b') this.command('toggle-sidebar')
      else if (k === '\\') this.toggleSplit()
      else if (k === 'f') this.command('find')
      else if (k === 'd') this.toggleBookmark()
      else if (k === 'h') this.openInternal('history')
      else if (k === 'j') this.openInternal('downloads')
      else if (k === ',') this.openInternal('settings')
      else if (k === 'p') this.current()?.view.webContents.print()
      else if (k === '=' || k === '+') this.zoom(ZOOM_STEP)
      else if (k === '-') this.zoom(-ZOOM_STEP)
      else if (k === '0') this.zoom(null)
      else if (k === 'tab') this.step(1)
      else if (/^[1-9]$/.test(k)) this.activateIndex(Number(k) - 1)
      else handled = false
    } else if (mod && input.alt && !input.shift) {
      const target = /^[1-9]$/.test(k) ? this.deps.spaces.list()[Number(k) - 1] : undefined
      if (target) this.switchSpace(target.id)
      else handled = false
    } else if (mod && input.shift && !input.alt) {
      if (k === 'tab') this.step(-1)
      else if (k === 'a') this.command('toggle-taskview')
      else if (k === 't') this.reopenClosed()
      else if (k === 'o') this.openInternal('bookmarks')
      else if (k === 'i') this.current()?.view.webContents.toggleDevTools()
      else if (k === '+') this.zoom(ZOOM_STEP)
      else handled = false
    } else if (input.alt && input.shift && !mod) {
      const dirs: Record<string, Edge> = {
        arrowleft: 'left',
        arrowright: 'right',
        arrowup: 'top',
        arrowdown: 'bottom'
      }
      if (dirs[k]) this.movePane(dirs[k])
      else handled = false
    } else if (input.alt && !mod && !input.shift) {
      if (k === 'arrowleft') this.back()
      else if (k === 'arrowright') this.forward()
      else handled = false
    } else if (k === 'f5' && !mod) {
      this.reload()
    } else if (k === 'f12' && !mod) {
      this.current()?.view.webContents.toggleDevTools()
    } else if (k === 'escape' && this.fullscreenId !== null) {
      this.setFullscreen(null)
    } else {
      handled = false
    }
    if (handled) event.preventDefault()
  }

  // ---- thumbnails ----

  private scheduleSnapshot(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (tab.thumbTimer) clearTimeout(tab.thumbTimer)
    tab.thumbTimer = setTimeout(() => void this.snapshot(id), 800)
  }

  private async snapshot(id: number): Promise<void> {
    const tab = this.tabs.get(id)
    if (!tab || this.overlay || !this.visibleIds().includes(id) || this.isBlank(tab)) return
    try {
      const img = await tab.view.webContents.capturePage()
      if (img.isEmpty() || !this.tabs.has(id)) return
      const jpeg = img.resize({ width: THUMB_WIDTH, quality: 'good' }).toJPEG(72)
      tab.thumb = 'data:image/jpeg;base64,' + jpeg.toString('base64')
      this.win.webContents.send('tabs:thumb', id, tab.thumb)
    } catch {
      // tab closed or view torn down mid-capture
    }
  }

  // ---- renderer sync ----

  private refresh(): void {
    this.applyVisibility()
    this.persistSession()
    if (!this.win.isDestroyed()) this.win.webContents.send('tabs:state', this.state())
  }

  private command(cmd: UiCommand): void {
    this.send('ui:command', cmd)
  }

  private send(channel: string, ...args: unknown[]): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, ...args)
  }
}
