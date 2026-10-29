import { is } from '@electron-toolkit/utils'
import {
  desktopCapturer,
  ipcMain,
  shell,
  systemPreferences,
  webContents as allContents,
  WebContentsView,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MediaAccessPermissionRequest,
  type NativeImage,
  type Session,
  type Streams,
  type WebContents,
  type WebFrameMain
} from 'electron'
import { join } from 'path'
import {
  ALWAYS_ALLOWED,
  grantIn,
  kindsFor,
  liveGrants,
  ONCE_MS,
  originOf,
  PERM_KINDS,
  permissionOrigin,
  resolveKinds,
  sanitizeGrants,
  staleKinds,
  withDecision,
  type PageAnswers,
  type PermDecision,
  type PermKind,
  type PermSetting,
  type SiteGrant
} from '../shared/permissions'
import {
  CAPTURE_SCRIPT,
  captureKindsOf,
  mergeSources,
  nextSharePass,
  SHARE_REFRESH_MS,
  shareAudio,
  stopCaptureScript,
  type SharePass
} from '../shared/capture'
import type {
  PermissionAnswer,
  PermissionPromptState,
  Rect,
  ScreenSource,
  SitePerm
} from '../shared/types'
import { JsonStore } from './store'
import { paintView } from './chromeTheme'

/** Where Windows keeps the switch that lets apps use the camera and the microphone. */
const SETTINGS_URL = {
  camera: 'ms-settings:privacy-webcam',
  microphone: 'ms-settings:privacy-microphone'
} as const

/** Whether the system itself is keeping apps from a device the request needs (Windows and macOS report it). */
function osBlocked(kinds: readonly PermKind[]): 'camera' | 'microphone' | null {
  for (const kind of ['camera', 'microphone'] as const) {
    if (!kinds.includes(kind)) continue
    try {
      const status = systemPreferences.getMediaAccessStatus(kind)
      if (status === 'denied' || status === 'restricted') return kind
    } catch {
      // not reported on this system: nothing is known to be blocked
    }
  }
  return null
}

/** From now on, have the frame tell its tab when it is capturing the camera, microphone or screen. */
function watchCapture(frame: WebFrameMain | null | undefined): void {
  if (frame && !frame.isDestroyed()) void frame.executeJavaScript(CAPTURE_SCRIPT).catch(() => {})
}

/** The frames of a page that asked from `url` (the page itself, or a call widget inside it). */
function framesAt(wc: WebContents, url: string): WebFrameMain[] {
  return wc.mainFrame.framesInSubtree.filter((f) => f.url === url)
}

const SOURCE_ATTEMPTS = 3
const SOURCE_RETRY_MS = 400
const THUMB = { width: 320, height: 180 }

/** A small JPEG of a picture: a PNG of every window, encoded on the main thread, is what made the picker slow. */
const jpeg = (img: NativeImage): string =>
  img.isEmpty() ? '' : `data:image/jpeg;base64,${img.toJPEG(60).toString('base64')}`

/**
 * One listing for the share picker: every screen and window by name only (a 0x0 size captures nothing, so it is
 * immediate), or the screens with small pictures. Null when the system could not list them this time.
 */
async function listPass(pass: SharePass): Promise<ScreenSource[] | null> {
  const found = await desktopCapturer
    .getSources({
      types: pass === 'names' ? ['screen', 'window'] : ['screen'],
      thumbnailSize: pass === 'names' ? { width: 0, height: 0 } : THUMB,
      fetchWindowIcons: false
    })
    .catch(() => null)
  return (
    found?.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
      thumb: pass === 'names' ? '' : jpeg(s.thumbnail),
      icon: ''
    })) ?? null
  )
}

const CARD_WIDTH = 340
const PAD = 36 // room around the card for its shadow (blur 24 + offset 8 + slack), so the view never clips it
const INSET = 12 // from the top-left corner of the page

/** Which answers changed: one site's, or (origin null) every site's. */
export interface PermChange {
  origin: string | null
  kinds: readonly PermKind[]
}

/**
 * What sites were allowed or blocked, per site and per kind of access, for one browsing session. The normal
 * profile's answers are saved; a private or Tor session's live in memory and go when Panes closes. "Allow this
 * time" answers are never saved anywhere and lapse after ONCE_MS.
 */
export class PermissionStore {
  private grants: SiteGrant[]
  private file: JsonStore<{ grants: SiteGrant[] }> | null
  private listeners = new Set<(change: PermChange) => void>()

  constructor(readonly persist = true) {
    this.file = persist ? new JsonStore('permissions', { grants: [] as SiteGrant[] }) : null
    this.grants = sanitizeGrants(this.file?.value.grants)
  }

  /** The answer in force, with its expiry when it is a "this time" one. */
  entry(origin: string, kind: PermKind): SiteGrant | undefined {
    return grantIn(this.grants, origin, kind, Date.now())
  }

  get(origin: string, kind: PermKind): PermDecision | undefined {
    return this.entry(origin, kind)?.decision
  }

  setting(origin: string, kind: PermKind): PermSetting {
    return this.get(origin, kind) ?? 'ask'
  }

  /** Answer `kinds` for a site: allow or block (until `expires`, if given), or null to ask again. */
  set(
    origin: string,
    kinds: readonly PermKind[],
    decision: PermDecision | null,
    expires?: number
  ): void {
    this.grants = withDecision(
      liveGrants(this.grants, Date.now()),
      origin,
      kinds,
      decision,
      expires
    )
    this.save()
    this.emit({ origin, kinds })
  }

  remove(origin: string, kind: PermKind): void {
    this.set(origin, [kind], null)
  }

  reset(): void {
    this.grants = []
    this.save()
    this.emit({ origin: null, kinds: PERM_KINDS })
  }

  list(): SiteGrant[] {
    return liveGrants(this.grants, Date.now())
  }

  onChange(cb: (change: PermChange) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(change: PermChange): void {
    for (const cb of this.listeners) cb(change)
  }

  private save(): void {
    if (!this.file) return
    this.file.value.grants = this.grants.filter((g) => g.expires === undefined)
    this.file.save()
  }
}

/** How a question ended: answered on the card, or settled by an answer that arrived meanwhile. */
type Outcome = PermissionAnswer | { action: 'known'; decision: PermDecision }

interface Pending {
  state: PermissionPromptState
  /** The page asking: its question waits until it is on screen, and goes away with it. */
  wc: WebContents | null
  /** Bumped when the page starts a new navigation: a question from before it belongs to the old page. */
  generation: number
  /** For a question about access: what the answers say now, so it can be settled without asking. */
  known?: () => PermDecision | 'ask'
  settle: (outcome: Outcome) => void
}

interface Deps {
  win: BrowserWindow
  /** Where the active tab's page sits, for the card to hang off its corner. */
  anchor: () => Rect | null
  onKeyboardLock: (wc: WebContents) => void
  /** A tab that is not on screen: its questions wait until it is. */
  hidden: (wc: WebContents) => boolean
}

/**
 * Asks before a page uses the camera, microphone, location, notifications, clipboard reads, MIDI, window
 * placement or screen capture. The question is a card in a transparent view stacked above the page (page views
 * are native and paint over the window's own UI). Answers are remembered per site; everything else is refused.
 *
 * The request handler (a page asking) and the check handler (a page looking: Notification.permission,
 * navigator.permissions, device labels) read the same answers, "this time" ones included, so a page is never
 * told one thing by one and another by the other. Each question belongs to the page that asked: it shows only
 * while that page is on screen, and goes when the page navigates away or closes. A change made in the site
 * settings settles questions it answers, stops capture it blocks, and is reported to whoever shows answers.
 */
export class PermissionManager {
  private view: WebContentsView | null = null
  private queue: Pending[] = []
  private shown: Pending | null = null
  private height = 150
  private nextId = 1
  private stores = new Map<Session, PermissionStore>()
  /** What each page (by WebContents id) has been told since it loaded. */
  private answers = new Map<number, PageAnswers>()
  /** Per page: how many navigations it has started, and which pages are already followed. */
  private generations = new Map<number, number>()
  private listeners = new Set<() => void>()
  /** Pages (WebContents ids) with a share picker open. */
  private picking = new Set<number>()
  /** The share picker's last system listing: the next one starts after it. */
  private listing: Promise<unknown> = Promise.resolve()

  constructor(private d: Deps) {
    d.win.on('resize', () => this.sync())
    const fromView = (e: IpcMainEvent | IpcMainInvokeEvent): boolean =>
      !!this.view && e.sender === this.view.webContents
    ipcMain.handle('perm:state', (e) => (fromView(e) ? (this.shown?.state ?? null) : null))
    ipcMain.on('perm:resize', (e, h: unknown) => {
      if (!fromView(e) || typeof h !== 'number' || !Number.isFinite(h) || h < 0) return
      this.height = Math.ceil(Math.min(h, 600))
      this.sync()
    })
    ipcMain.on('perm:answer', (e, id: unknown, answer: PermissionAnswer) => {
      const shown = this.shown
      if (fromView(e) && shown && shown.state.id === id) this.answer(shown, answer)
    })
  }

  /** The answers pages in `session` are given. */
  storeFor(session: Session): PermissionStore | null {
    return this.stores.get(session) ?? null
  }

  /** Answers changed somewhere, or a page was told something new. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Every kind for one site as the site settings show it, and which of them the page has to reload to see. */
  siteState(
    session: Session,
    origin: string,
    wc: WebContents | null
  ): { perms: SitePerm[]; reload: PermKind[] } {
    const store = this.storeFor(session)
    const answers = (wc && this.answers.get(wc.id)) || {}
    const perms = PERM_KINDS.map((kind): SitePerm => {
      const g = store?.entry(origin, kind)
      const told = answers[kind]
      return {
        kind,
        setting: g?.decision ?? 'ask',
        until: g?.expires ?? null,
        asked: told ? (told.granted ? 'granted' : 'refused') : null
      }
    })
    const settingOf = (k: PermKind): PermSetting => store?.setting(origin, k) ?? 'ask'
    return { perms, reload: staleKinds(answers, settingOf) }
  }

  /** Ask for, and answer, what pages in `session` request, from `store`. */
  install(session: Session, store: PermissionStore): void {
    this.stores.set(session, store)
    store.onChange((change) => this.changed(session, store, change))

    session.setPermissionRequestHandler((wc, permission, cb, details) => {
      if (ALWAYS_ALLOWED.has(permission)) {
        if (permission === 'keyboardLock') this.d.onKeyboardLock(wc)
        return cb(true)
      }
      const kinds = kindsFor(permission, (details as MediaAccessPermissionRequest).mediaTypes)
      const origin = kinds && permissionOrigin(kinds, details.requestingUrl, wc.getURL())
      if (!kinds || !origin) return cb(false)
      const finish = (granted: boolean): void => {
        this.tell(wc, store, origin, kinds, granted)
        if (granted && captureKindsOf(kinds).length > 0) {
          for (const f of framesAt(wc, details.requestingUrl)) watchCapture(f)
        }
        cb(granted)
      }
      // Sharing the screen is consented to in the picker, every time, so a stored Allow or no answer both go on
      // to it; only a stored Block stops the request here.
      if (kinds.length === 1 && kinds[0] === 'screen') {
        return finish(store.get(origin, 'screen') !== 'block')
      }
      if (resolveKinds(kinds, (k) => store.get(origin, k)) === 'block') return finish(false)
      // Windows can keep apps away from the camera and microphone altogether: say so, rather than fail quietly.
      const blocked = osBlocked(kinds)
      if (blocked) {
        void this.ask({ origin, kinds, blocked }, wc).then((a) => {
          if (a.action === 'openSettings') void shell.openExternal(SETTINGS_URL[blocked])
        })
        return finish(false)
      }
      void this.decide(wc, store, origin, kinds).then((d) => finish(d === 'allow'))
    })

    // Synchronous checks never ask. They are answered from the same store as requests, and what a page learns
    // from them is noted like an answer, so the site settings know when a page holds an outdated "denied".
    session.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      if (ALWAYS_ALLOWED.has(permission)) return true
      const mediaType = details.mediaType
      const kinds = kindsFor(
        permission,
        mediaType === 'video' ? ['video'] : mediaType === 'audio' ? ['audio'] : ['video', 'audio']
      )
      const origin = kinds && permissionOrigin(kinds, requestingOrigin, wc?.getURL())
      if (!kinds || !origin) return false
      const allowed = (k: PermKind): boolean => store.get(origin, k) === 'allow'
      const settled = kinds.filter((k) => store.get(origin, k) !== undefined)
      if (wc && settled.length > 0) this.tell(wc, store, origin, settled, null)
      return mediaType === 'unknown' || !mediaType ? kinds.some(allowed) : kinds.every(allowed)
    })

    // Screen sharing is picked from a list every time; a site whose screen sharing is blocked gets no list.
    // One picker per page at a time: a second request while one is open (the share button clicked again while
    // the first listing was slow) is refused instead of queueing a second picker behind the first.
    session.setDisplayMediaRequestHandler(
      (request, callback) => {
        const frame = request.frame
        const wc = frame && !frame.isDestroyed() ? allContents.fromFrame(frame) : undefined
        const origin = frame
          ? permissionOrigin(['screen'], frame.url, frame.top?.url)
          : originOf(request.securityOrigin)
        const reply = (streams: Streams | null): void => {
          try {
            callback(streams)
          } catch {
            // the frame went away while the picker was open
          }
        }
        if (!origin || store.get(origin, 'screen') === 'block') {
          if (wc && origin) this.tell(wc, store, origin, ['screen'], false)
          return reply(null)
        }
        if (wc && this.picking.has(wc.id)) return reply(null)
        if (wc) this.picking.add(wc.id)
        void this.pickScreen(origin, request.audioRequested, wc ?? null).then((streams) => {
          if (wc) this.picking.delete(wc.id)
          if (wc) this.tell(wc, store, origin, ['screen'], !!streams)
          if (streams) watchCapture(frame)
          reply(streams)
        })
      },
      { useSystemPicker: false }
    )
  }

  /** Keep the card above page views made since it was shown, and show the question of the page now on screen. */
  sync(): void {
    if (this.d.win.isDestroyed()) return
    const next =
      this.queue.find((p) => !p.wc || (!p.wc.isDestroyed() && !this.d.hidden(p.wc))) ?? null
    const changed = next !== this.shown
    this.shown = next
    if (!next) {
      this.view?.setVisible(false)
      return
    }
    if (changed) this.height = 150
    const view = this.ensureView()
    const [winW, winH] = this.d.win.getContentSize()
    const page = this.d.anchor()
    // Choosing what to share is a modal dialog in the middle of the window, dimming it; everything else
    // is a small card at the corner of the page.
    const modal = !!next.state.sources
    const width = modal ? winW : CARD_WIDTH + PAD * 2
    const height = modal ? winH : Math.min(this.height + PAD * 2, winH)
    const x = modal ? 0 : Math.max(0, Math.min((page?.x ?? 80) + INSET - PAD, winW - width))
    const y = modal ? 0 : Math.max(0, (page?.y ?? 60) + INSET - PAD)
    view.setBounds({ x, y, width, height })
    // Re-adding moves it to the top, above any tab views created since it was last shown.
    this.d.win.contentView.addChildView(view)
    view.setVisible(true)
    if (!changed) return
    paintView(view.webContents)
    // The picker is a modal dialog: it takes the keyboard (Esc, Enter, Tab) from its first frame. The small card
    // does not: it must not take typing away from the page.
    if (modal) view.webContents.focus()
    if (!view.webContents.isLoading()) view.webContents.send('perm:state', next.state)
  }

  private async decide(
    wc: WebContents,
    store: PermissionStore,
    origin: string,
    kinds: PermKind[]
  ): Promise<PermDecision> {
    const known = (): PermDecision | 'ask' => resolveKinds(kinds, (k) => store.get(origin, k))
    const now = known()
    if (now !== 'ask') return now
    const outcome = await this.ask({ origin, kinds, temporary: !store.persist }, wc, known)
    switch (outcome.action) {
      case 'known':
        return outcome.decision
      case 'allow':
        store.set(origin, kinds, 'allow')
        return 'allow'
      case 'once':
        store.set(origin, kinds, 'allow', Date.now() + ONCE_MS)
        return 'allow'
      case 'block':
        store.set(origin, kinds, 'block')
        return 'block'
      default:
        return 'block' // dismissed, or the page went away: refused this time, asked again next time
    }
  }

  /**
   * The screen-sharing picker. It opens at once and is filled in by listSources while it is open, so neither the
   * picker nor the page waits on the system listing screens and windows (which, with pictures of each, took
   * seconds). The answer goes back to the page as soon as it is given. Null means nothing was shared.
   */
  private async pickScreen(
    origin: string,
    audio: boolean,
    wc: WebContents | null
  ): Promise<Streams | null> {
    const { pending, outcome } = this.enqueue(
      { origin, kinds: ['screen'], sources: [], loading: true, audio },
      wc
    )
    void this.listSources(pending)
    const answer = await outcome
    if (answer.action !== 'share') return null
    const source = pending.state.sources?.find((s) => s.id === answer.sourceId)
    if (!source) return null
    const video = { id: source.id, name: source.name }
    // Whole-screen capture can carry the system's sound (Windows); a single window cannot. The dialog lets the
    // user decline it.
    return shareAudio(source.id, audio, answer.audio) ? { video, audio: 'loopback' } : { video }
  }

  /**
   * Fill an open picker in, pass by pass (see nextSharePass): names first, at once and without pictures, then
   * small JPEG pictures of the screens, then both again every SHARE_REFRESH_MS while it is on screen. It stops
   * when the picker closes. Listings never overlap, here or with another picker: each waits for the one before.
   * A first listing that comes back empty
   * (the capture service starting up) is tried again before the picker says there is nothing to share.
   */
  private async listSources(p: Pending): Promise<void> {
    const open = (): boolean => this.queue.includes(p)
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    let done: SharePass | null = null
    let tries = 0
    while (open()) {
      const { pass, delay } = nextSharePass(done)
      if (delay > 0) await wait(delay)
      if (!open()) return
      if (this.shown !== p && done !== null) {
        await wait(SHARE_REFRESH_MS) // not on screen (its tab is in the background): nothing to keep fresh
        continue
      }
      const run = this.listing.then(() => (open() ? listPass(pass) : null))
      this.listing = run.catch(() => null)
      const found = await run
      if (!open()) return
      if (pass === 'names' && found?.length === 0 && ++tries < SOURCE_ATTEMPTS) {
        await wait(SOURCE_RETRY_MS)
        continue
      }
      if (found) {
        const kinds: ScreenSource['kind'][] = pass === 'names' ? ['screen', 'window'] : ['screen']
        this.restate(p, {
          loading: false,
          sources: mergeSources(p.state.sources ?? [], found, kinds)
        })
      } else if (pass === 'names') {
        this.restate(p, { loading: false })
      }
      done = pass
    }
  }

  private ask(
    state: Omit<PermissionPromptState, 'id'>,
    wc: WebContents | null,
    known?: () => PermDecision | 'ask'
  ): Promise<Outcome> {
    return this.enqueue(state, wc, known).outcome
  }

  private enqueue(
    state: Omit<PermissionPromptState, 'id'>,
    wc: WebContents | null,
    known?: () => PermDecision | 'ask'
  ): { pending: Pending; outcome: Promise<Outcome> } {
    if (wc) this.follow(wc)
    let resolve!: (o: Outcome) => void
    const outcome = new Promise<Outcome>((r) => (resolve = r))
    const pending: Pending = {
      state: { ...state, id: this.nextId++ },
      wc,
      generation: wc ? (this.generations.get(wc.id) ?? 0) : 0,
      known,
      settle: (o) => {
        const i = this.queue.indexOf(pending)
        if (i === -1) return // already settled: a question is answered once
        this.queue.splice(i, 1)
        resolve(o)
        this.sync()
      }
    }
    this.queue.push(pending)
    this.sync()
    return { pending, outcome }
  }

  /** Change what a waiting question shows (the picker's list arriving), on screen too if it is showing. */
  private restate(p: Pending, patch: Partial<PermissionPromptState>): void {
    if (!this.queue.includes(p)) return
    p.state = { ...p.state, ...patch }
    const wc = this.view?.webContents
    if (this.shown === p && wc && !wc.isLoading()) wc.send('perm:state', p.state)
  }

  /** The user answered the card. Not now also answers the same page's queued copies of the question. */
  private answer(p: Pending, answer: PermissionAnswer): void {
    p.settle(answer)
    if (answer.action !== 'cancel' || !p.known) return
    for (const q of [...this.queue]) {
      const same =
        q.known &&
        q.wc === p.wc &&
        q.state.origin === p.state.origin &&
        q.state.kinds.every((k) => p.state.kinds.includes(k))
      if (same) q.settle(answer)
    }
  }

  /** Note what a page was told for `kinds` (`granted` null: as the store says now). */
  private tell(
    wc: WebContents,
    store: PermissionStore,
    origin: string,
    kinds: readonly PermKind[],
    granted: boolean | null
  ): void {
    if (wc.isDestroyed()) return
    this.follow(wc)
    const answers = this.answers.get(wc.id) ?? {}
    let news = false
    for (const kind of kinds) {
      const setting = store.setting(origin, kind)
      const told = { granted: granted ?? setting === 'allow', setting }
      const was = answers[kind]
      if (was?.granted === told.granted && was.setting === told.setting) continue
      answers[kind] = told
      news = true
    }
    this.answers.set(wc.id, answers)
    if (news) this.emit()
  }

  /** Forget what a page was told when it is replaced, and drop the questions of a page that is gone. */
  private follow(wc: WebContents): void {
    const id = wc.id
    if (this.generations.has(id)) return
    this.generations.set(id, 0)
    wc.on('did-start-navigation', (d) => {
      if (d.isMainFrame && !d.isSameDocument)
        this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
    })
    // A navigation that never commits (a download, a 204) leaves the page and its questions where they were.
    wc.on('did-navigate', () => {
      this.answers.delete(id)
      const now = this.generations.get(id) ?? 0
      this.drop((p) => p.wc === wc && p.generation < now)
      this.emit()
    })
    wc.once('destroyed', () => {
      this.answers.delete(id)
      this.generations.delete(id)
      this.drop((p) => p.wc === wc)
    })
  }

  private drop(which: (p: Pending) => boolean): void {
    for (const p of this.queue.filter(which)) p.settle({ action: 'cancel' })
  }

  /** Answers changed (here, in the site settings or in Settings): apply them to the pages open now. */
  private changed(session: Session, store: PermissionStore, change: PermChange): void {
    for (const wc of allContents.getAllWebContents()) {
      if (wc.isDestroyed() || wc.session !== session) continue
      const origin = originOf(wc.getURL())
      if (!origin || (change.origin !== null && origin !== change.origin)) continue
      // A blocked camera, microphone or screen share stops now, as in Chrome, rather than at the next reload.
      const stop = captureKindsOf(change.kinds.filter((k) => store.get(origin, k) === 'block'))
      if (stop.length === 0) continue
      for (const f of wc.mainFrame.framesInSubtree) {
        void f.executeJavaScript(stopCaptureScript(stop)).catch(() => {})
      }
    }
    // Questions the change answers are settled now, instead of asking what was just decided.
    for (const p of [...this.queue]) {
      const d = p.known?.()
      if (d && d !== 'ask') p.settle({ action: 'known', decision: d })
    }
    this.emit()
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
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
}
