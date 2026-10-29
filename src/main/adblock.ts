import { app, ipcMain, webContents, type IpcMainInvokeEvent, type Session } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import buildEngine from './adblockWorker?nodeWorker'
import { siteListed } from '../shared/memory'
import { siteKey } from '../shared/sitetheme'
import { isYouTubeAdRequest, isYouTubeUrl } from '../shared/youtube'

/** A saved engine older than this is rebuilt: uBlock Origin answers YouTube's changes within a day. */
const ENGINE_MAX_AGE_MS = 12 * 60 * 60 * 1000
/** How often a long-running app looks at the engine's age (it only rebuilds when the engine is too old). */
const CHECK_EVERY_MS = 60 * 60 * 1000
/** A stale engine is used at once and replaced once startup has settled, not during it. */
const REFRESH_DELAY_MS = 30 * 1000

const COSMETIC_CHANNELS = [
  '@ghostery/adblocker/inject-cosmetic-filters',
  '@ghostery/adblocker/is-mutation-observer-enabled'
]

/**
 * Network-level ads + tracker blocking, page-hiding styles and the lists' scriptlets.
 *
 * The engine is saved on disk and used whatever its age (old lists block nearly everything; none block
 * nothing), then rebuilt from fresh lists in a worker thread when it is over half a day old, at startup and
 * every so often while the app stays open. The new engine replaces the old one in place. A failed download
 * keeps the old engine and is tried again at the next check.
 */
export class Adblock {
  private blocker: ElectronBlocker | null = null
  private building = false
  private want = false
  private off: readonly string[] = []
  private noCosmetic: readonly string[] = []
  /** Requests stopped per page, counted from the page's own address so a new page starts again at zero. */
  private blocked = new Map<number, { page: string; count: number }>()
  private file = join(app.getPath('userData'), 'adblock-engine.bin')

  private sessions: Session[]

  constructor(session: Session) {
    this.sessions = [session]
    void this.load()
    setInterval(() => void this.refreshIfStale(), CHECK_EVERY_MS).unref()
  }

  private async load(): Promise<void> {
    try {
      this.use(ElectronBlocker.deserialize(await fs.readFile(this.file)))
    } catch {
      // missing, damaged, or written by another version of the engine: nothing to block with until built
      await this.refresh()
      return
    }
    setTimeout(() => void this.refreshIfStale(), REFRESH_DELAY_MS).unref()
  }

  private async refreshIfStale(): Promise<void> {
    const age = await fs.stat(this.file).then(
      (s) => Date.now() - s.mtimeMs,
      () => Infinity
    )
    if (age > ENGINE_MAX_AGE_MS) await this.refresh()
  }

  /** Fetch the lists and build an engine off the main thread (see adblockWorker.ts), then save and use it. */
  private async refresh(): Promise<void> {
    if (this.building) return
    this.building = true
    try {
      const data = await new Promise<Uint8Array>((resolve, reject) => {
        const worker = buildEngine({})
        worker.once('message', (msg: Uint8Array | string) => {
          void worker.terminate()
          if (typeof msg === 'string') reject(new Error(msg))
          else resolve(msg)
        })
        worker.once('error', reject)
        worker.once('exit', (code) => reject(new Error(`engine worker exited (${code})`)))
      })
      // Read it back before saving, so a bad build never replaces a good file.
      const next = ElectronBlocker.deserialize(data)
      const tmp = this.file + '.tmp'
      await fs.writeFile(tmp, data)
      await fs.rename(tmp, this.file)
      this.use(next)
    } catch (err) {
      console.error('[adblock] list update failed:', err)
    } finally {
      this.building = false
    }
  }

  /** Swap in an engine: the old one lets go of every session before the new one takes them. */
  private use(next: ElectronBlocker): void {
    const prev = this.blocker
    if (prev) {
      for (const session of this.sessions) {
        if (prev.isBlockingEnabled(session)) prev.disableBlockingInSession(session)
      }
    }
    this.exempt(next)
    next.on('request-blocked', (request) => this.count(request.tabId))
    this.blocker = next
    this.apply()
  }

  /** Sites (host names) the blocker leaves alone, subdomains included. */
  setOffSites(sites: readonly string[], noCosmetic: readonly string[]): void {
    this.off = sites
    this.noCosmetic = noCosmetic
  }

  private count(id: number): void {
    const wc = webContents.fromId(id)
    if (!wc || wc.isDestroyed()) return
    const page = wc.getURL()
    const seen = this.blocked.get(id)
    if (seen?.page === page) seen.count++
    else this.blocked.set(id, { page, count: 1 })
  }

  /** Requests blocked on the page currently in this WebContents. */
  blockedOn(id: number): number {
    const wc = webContents.fromId(id)
    const seen = this.blocked.get(id)
    return wc && !wc.isDestroyed() && seen?.page === wc.getURL() ? seen.count : 0
  }

  private listed(pageUrl: string): boolean {
    const key = siteKey(pageUrl)
    return !!key && siteListed(key, this.off)
  }

  /** Whether the blocker is at work on a page's site, and whether it may hide the page's elements there. */
  siteState(pageUrl: string): { blocking: boolean; cosmetic: boolean } {
    const key = siteKey(pageUrl)
    return {
      blocking: this.want && !this.listed(pageUrl),
      cosmetic: !key || !siteListed(key, this.noCosmetic)
    }
  }

  /**
   * The lists' scriptlets for a YouTube frame, for its preload to run at document start (src/main/youtube.ts).
   * None until the engine has loaded. Only asked for YouTube's hosts, whose registrable domain is their last
   * two labels, which spares a public suffix lookup.
   */
  youtubeScriptlets(frameUrl: string): string[] {
    if (!this.blocker || !isYouTubeUrl(frameUrl)) return []
    const hostname = new URL(frameUrl).hostname
    const { active, scripts } = this.blocker.getCosmeticsFilters({
      url: frameUrl,
      hostname,
      domain: hostname.split('.').slice(-2).join('.'),
      getBaseRules: false,
      getInjectionRules: true,
      getExtendedRules: false,
      getRulesFromHostname: true,
      getRulesFromDOM: false
    })
    return active === false ? [] : scripts
  }

  /**
   * The engine's session hooks look its handlers up on every call, so wrapping them here is what lets one
   * site opt out: requests, response headers and page-hiding styles are all skipped for the page's own site.
   */
  private exempt(blocker: ElectronBlocker): void {
    // A page can be gone by the time its last requests arrive (a tab closing, the app quitting), and a
    // destroyed WebContents throws when asked anything: treat that as "no page" and let the engine decide.
    const pageOf = (id: number | undefined): string => {
      const wc = id ? webContents.fromId(id) : undefined
      return wc && !wc.isDestroyed() ? wc.getURL() : ''
    }
    const before = blocker.onBeforeRequest
    blocker.onBeforeRequest = (details, callback) => {
      const page = pageOf(details.webContentsId)
      if (page && this.listed(page)) callback({})
      else if (details.resourceType !== 'mainFrame' && isYouTubeAdRequest(details.url)) {
        if (details.webContentsId) this.count(details.webContentsId)
        callback({ cancel: true })
      } else before(details, callback)
    }
    const headers = blocker.onHeadersReceived
    blocker.onHeadersReceived = (details, callback) => {
      if (this.listed(pageOf(details.webContentsId) || details.url)) callback({})
      else headers(details, callback)
    }
    const cosmetic = blocker.onInjectCosmeticFilters
    blocker.onInjectCosmeticFilters = async (event, url, msg) => {
      const page = event.sender.isDestroyed() ? '' : event.sender.getURL()
      const at = page || url
      if (this.listed(at)) return
      const key = siteKey(at)
      if (key && siteListed(key, this.noCosmetic)) return
      // A YouTube frame's preload has already run its scriptlets, at document start and in the right frame;
      // the engine would run them again, late, and always in the top frame. Its styles are still wanted.
      return cosmetic(isYouTubeUrl(url) ? withoutScripts(event) : event, url, msg)
    }
  }

  /** Also block in another session (the private one), with the same engine and exceptions. */
  attach(session: Session): void {
    this.sessions.push(session)
    this.apply()
  }

  /**
   * The engine registers its page-side handlers once per channel for the whole app, and refuses a second
   * registration. They answer for any session, so each enabling replaces them rather than adding to them.
   */
  private enable(blocker: ElectronBlocker, session: Session): void {
    for (const channel of COSMETIC_CHANNELS) ipcMain.removeHandler(channel)
    blocker.enableBlockingInSession(session)
  }

  /** Bring every session in line with the switch (the engine may still be loading: then this waits for it). */
  private apply(): void {
    const blocker = this.blocker
    if (!blocker) return
    for (const session of this.sessions) {
      const on = blocker.isBlockingEnabled(session)
      if (this.want && !on) this.enable(blocker, session)
      else if (!this.want && on) blocker.disableBlockingInSession(session)
    }
  }

  set(enabled: boolean): void {
    this.want = enabled
    this.apply()
  }
}

/**
 * The same event (everything else inherited from it) with a sender that ignores `executeJavaScript`. Other
 * methods are bound to the real WebContents, since its native methods refuse any other `this`.
 */
function withoutScripts(event: IpcMainInvokeEvent): IpcMainInvokeEvent {
  const sender = new Proxy(event.sender, {
    get: (target, prop) => {
      if (prop === 'executeJavaScript') return () => Promise.resolve()
      const value: unknown = Reflect.get(target, prop)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  return Object.create(event, { sender: { value: sender } }) as IpcMainInvokeEvent
}
