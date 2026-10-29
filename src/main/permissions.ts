import { is } from '@electron-toolkit/utils'
import {
  desktopCapturer,
  ipcMain,
  WebContentsView,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents
} from 'electron'
import { join } from 'path'
import {
  ALWAYS_ALLOWED,
  kindsFor,
  originOf,
  resolveKinds,
  type PermDecision,
  type PermKind,
  type SiteGrant
} from '../shared/permissions'
import type { PermissionAnswer, PermissionPromptState, Rect } from '../shared/types'
import { JsonStore } from './store'
import { paintView } from './chromeTheme'

const CARD_WIDTH = 340
const PAD = 36 // room around the card for its shadow (blur 24 + offset 8 + slack), so the view never clips it
const INSET = 12 // from the top-left corner of the page

/** What sites were allowed or blocked, per site and per kind of access. */
export class PermissionStore {
  private store = new JsonStore<{ grants: SiteGrant[] }>('permissions', { grants: [] })

  get(origin: string, kind: PermKind): PermDecision | undefined {
    return this.store.value.grants.find((g) => g.origin === origin && g.kind === kind)?.decision
  }

  set(origin: string, kinds: readonly PermKind[], decision: PermDecision): void {
    const grants = this.store.value.grants.filter(
      (g) => !(g.origin === origin && kinds.includes(g.kind))
    )
    for (const kind of kinds) grants.push({ origin, kind, decision })
    this.store.value.grants = grants
    this.store.save()
  }

  remove(origin: string, kind: PermKind): void {
    this.store.value.grants = this.store.value.grants.filter(
      (g) => !(g.origin === origin && g.kind === kind)
    )
    this.store.save()
  }

  reset(): void {
    this.store.value.grants = []
    this.store.save()
  }

  list(): SiteGrant[] {
    return this.store.value.grants
  }
}

interface Pending {
  state: PermissionPromptState
  settle: (answer: PermissionAnswer) => void
}

/**
 * Asks before a page uses the camera, microphone, location, notifications, clipboard reads or screen
 * capture. The question is a card in a transparent view stacked above the page (page views are native
 * and paint over the window's own UI). Answers are remembered per site; everything else is refused.
 */
export class PermissionManager {
  private view: WebContentsView | null = null
  private queue: Pending[] = []
  private current: Pending | null = null
  private height = 150
  /** Requests already waiting on an answer for the same site and kinds share it. */
  private inflight = new Map<string, Promise<PermDecision>>()

  constructor(
    private win: BrowserWindow,
    private store: PermissionStore,
    private anchor: () => Rect | null,
    private onKeyboardLock: (wc: WebContents) => void
  ) {
    win.on('resize', () => this.sync())
    const fromView = (e: IpcMainEvent | IpcMainInvokeEvent): boolean =>
      !!this.view && e.sender === this.view.webContents
    ipcMain.handle('perm:state', (e) => (fromView(e) ? (this.current?.state ?? null) : null))
    ipcMain.on('perm:resize', (e, h: unknown) => {
      if (!fromView(e) || typeof h !== 'number' || !Number.isFinite(h) || h < 0) return
      this.height = Math.ceil(Math.min(h, 600))
      this.sync()
    })
    ipcMain.on('perm:answer', (e, answer: PermissionAnswer) => {
      if (fromView(e) && this.current) this.current.settle(answer)
    })
  }

  install(session: Session): void {
    session.setPermissionRequestHandler((wc, permission, cb, details) => {
      if (ALWAYS_ALLOWED.has(permission)) {
        if (permission === 'keyboardLock') this.onKeyboardLock(wc)
        return cb(true)
      }
      const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes
      const kinds = kindsFor(permission, mediaTypes)
      const origin = originOf(details.requestingUrl)
      if (!kinds || !origin) return cb(false)
      void this.decide(origin, kinds).then((d) => cb(d === 'allow'))
    })

    // Synchronous checks (Notification.permission, navigator.permissions.query, device labels): never asks.
    session.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
      if (ALWAYS_ALLOWED.has(permission)) return true
      const mediaType = (details as { mediaType?: string }).mediaType
      const kinds = kindsFor(
        permission,
        mediaType === 'video' ? ['video'] : mediaType === 'audio' ? ['audio'] : ['video', 'audio']
      )
      const origin = originOf(requestingOrigin)
      if (!kinds || !origin) return false
      const allowed = (k: PermKind): boolean => this.store.get(origin, k) === 'allow'
      return mediaType === 'unknown' || !mediaType ? kinds.some(allowed) : kinds.every(allowed)
    })

    // Screen sharing is picked from a list every time, never remembered.
    session.setDisplayMediaRequestHandler(
      (request, callback) => {
        void this.pickScreen(originOf(request.frame?.url ?? ''), request.audioRequested).then(
          (streams) => callback(streams as Parameters<typeof callback>[0])
        )
      },
      { useSystemPicker: false }
    )
  }

  private async decide(origin: string, kinds: PermKind[]): Promise<PermDecision> {
    const stored = resolveKinds(kinds, (k) => this.store.get(origin, k))
    if (stored !== 'ask') return stored

    const key = origin + '|' + kinds.join(',')
    const waiting = this.inflight.get(key)
    if (waiting) return waiting
    const answer = this.ask({ origin, kinds }).then((a) => {
      this.inflight.delete(key)
      if (a.action === 'allow') this.store.set(origin, kinds, 'allow')
      if (a.action === 'block') this.store.set(origin, kinds, 'block')
      return a.action === 'allow' || a.action === 'once' ? ('allow' as const) : ('block' as const)
    })
    this.inflight.set(key, answer)
    return answer
  }

  private async pickScreen(origin: string | null, audio: boolean): Promise<object> {
    if (!origin) return {}
    const found = await desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } })
      .catch(() => [])
    if (found.length === 0) return {}
    const answer = await this.ask({
      origin,
      kinds: ['screen'],
      sources: found.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
        thumb: s.thumbnail.toDataURL()
      }))
    })
    const source =
      answer.action === 'share' ? found.find((s) => s.id === answer.sourceId) : undefined
    if (!source) return {}
    // Whole-screen capture can carry the system's sound (Windows); a single window cannot.
    return {
      video: source,
      ...(audio && source.id.startsWith('screen:') ? { audio: 'loopback' } : {})
    }
  }

  private ask(state: PermissionPromptState): Promise<PermissionAnswer> {
    return new Promise((resolve) => {
      const pending: Pending = {
        state,
        settle: (answer) => {
          if (this.current !== pending) return
          this.current = null
          resolve(answer)
          this.next()
        }
      }
      this.queue.push(pending)
      if (!this.current) this.next()
    })
  }

  private next(): void {
    this.current = this.queue.shift() ?? null
    this.height = 150
    this.sync()
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view
    const view = new WebContentsView({
      webPreferences: { sandbox: true, preload: join(__dirname, '../preload/permission.js') }
    })
    view.setBackgroundColor('#00000000')
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl) void view.webContents.loadURL(`${devUrl}/permission.html`)
    else void view.webContents.loadFile(join(__dirname, '../renderer/permission.html'))
    this.view = view
    return view
  }

  private sync(): void {
    if (this.win.isDestroyed()) return
    if (!this.current) {
      this.view?.setVisible(false)
      return
    }
    const view = this.ensureView()
    const [winW, winH] = this.win.getContentSize()
    const page = this.anchor()
    const width = CARD_WIDTH + PAD * 2
    const height = Math.min(this.height + PAD * 2, winH)
    const x = Math.max(0, Math.min((page?.x ?? 80) + INSET - PAD, winW - width))
    const y = Math.max(0, (page?.y ?? 60) + INSET - PAD)
    view.setBounds({ x, y, width, height })
    // Re-adding moves it to the top, above any tab views created since it was last shown.
    this.win.contentView.addChildView(view)
    paintView(view.webContents)
    view.setVisible(true)
    if (!view.webContents.isLoading()) view.webContents.send('perm:state', this.current.state)
  }
}
