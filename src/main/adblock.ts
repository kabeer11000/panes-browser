import { app, webContents, type Session } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { siteListed } from '../shared/memory'
import { siteKey } from '../shared/sitetheme'

/** Network-level ads + tracker blocking. The engine is cached on disk; failure to load is non-fatal. */
export class Adblock {
  private ready: Promise<ElectronBlocker | null>
  private active = false
  private off: readonly string[] = []

  constructor(private session: Session) {
    this.ready = ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: join(app.getPath('userData'), 'adblock-engine.bin'),
      read: fs.readFile,
      write: fs.writeFile
    }).catch((err) => {
      console.error('[adblock] failed to load:', err)
      return null
    })
    void this.ready.then((blocker) => blocker && this.exempt(blocker))
  }

  /** Sites (host names) the blocker leaves alone, subdomains included. */
  setOffSites(sites: readonly string[]): void {
    this.off = sites
  }

  private listed(pageUrl: string): boolean {
    const key = siteKey(pageUrl)
    return !!key && siteListed(key, this.off)
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
      else before(details, callback)
    }
    const headers = blocker.onHeadersReceived
    blocker.onHeadersReceived = (details, callback) => {
      if (this.listed(pageOf(details.webContentsId) || details.url)) callback({})
      else headers(details, callback)
    }
    const cosmetic = blocker.onInjectCosmeticFilters
    blocker.onInjectCosmeticFilters = async (event, url, msg) => {
      const page = event.sender.isDestroyed() ? '' : event.sender.getURL()
      if (this.listed(page || url)) return
      return cosmetic(event, url, msg)
    }
  }

  async set(enabled: boolean): Promise<void> {
    const blocker = await this.ready
    if (!blocker || enabled === this.active) return
    this.active = enabled
    if (enabled) blocker.enableBlockingInSession(this.session)
    else blocker.disableBlockingInSession(this.session)
  }
}
