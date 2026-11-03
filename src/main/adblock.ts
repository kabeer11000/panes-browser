import {
  app,
  ipcMain,
  net,
  webContents,
  type OnBeforeRequestListenerDetails,
  type Session,
  type WebFrameMain
} from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { getDomain, getHostname } from 'tldts'
import { Engine, FilterSet } from 'adblock-rs'
import bundledResources from '../../resources/adblock-resources.json?asset'
import buildEngine from './adblockWorker?nodeWorker'
import type { BuildInput, BuiltEngines } from './adblockWorker'
import {
  CANARY,
  CATALOG_URL,
  RESOURCES_URL,
  decide,
  packEngines,
  pickLists,
  requestType,
  sameSite,
  unpackEngines,
  type CatalogEntry,
  type CosmeticStart
} from '@shared/adblock'
import { siteListed } from '@shared/memory'
import { siteKey } from '@shared/sitetheme'
import type { Settings } from '@shared/types'
import { isYouTubeAdRequest, isYouTubeUrl } from '@shared/youtube'

/** A saved engine older than this is rebuilt: uBlock Origin answers YouTube's changes within a day. */
const ENGINE_MAX_AGE_MS = 12 * 60 * 60 * 1000
/** How often a long-running app looks at the engine's age (it only rebuilds when the engine is too old). */
const CHECK_EVERY_MS = 60 * 60 * 1000
/** A stale engine is used at once and replaced once startup has settled, not during it. */
const REFRESH_DELAY_MS = 30 * 1000

interface Engines {
  all: Engine
  firstParty: Engine
}

type Config = Pick<
  Settings,
  | 'adblock'
  | 'adblockOffSites'
  | 'adblockCosmeticOffSites'
  | 'adblockAggressive'
  | 'adblockAggressiveSites'
>

/**
 * Ad and tracker blocking on Brave's engine (adblock-rs): requests here, page hiding and scriptlets in each
 * frame's preload (src/preload/adblock.ts).
 *
 * The engines are saved on disk and used whatever their age (old lists block nearly everything; none block
 * nothing), then rebuilt from fresh lists in a worker thread when over half a day old, at startup and every
 * so often while the app stays open. A failed update keeps the old engines and is tried again at the next
 * check. Every loaded engine is first checked against known requests, since a damaged file loads as an engine
 * that quietly blocks nothing.
 */
export class Adblock {
  private engines: Engines | null = null
  private building = false
  private config: Config = {
    adblock: false,
    adblockOffSites: [],
    adblockCosmeticOffSites: [],
    adblockAggressive: false,
    adblockAggressiveSites: []
  }
  /** Requests stopped per page, counted from the page's own address so a new page starts again at zero. */
  private blocked = new Map<number, { page: string; count: number }>()
  private file = join(app.getPath('userData'), 'adblock.dat')
  private sessions: Session[] = []

  constructor(session: Session) {
    void fs.rm(join(app.getPath('userData'), 'adblock-engine.bin'), { force: true }) // the Ghostery engine's file
    ipcMain.on('adblock:start', (e) => {
      try {
        e.returnValue = this.cosmeticStart(e.senderFrame)
      } catch (err) {
        console.error('[adblock] start failed:', err)
        e.returnValue = null // the frame is blocked until it gets a value, whatever happens
      }
    })
    ipcMain.handle('adblock:generic', (_e, classes: unknown, ids: unknown, exceptions: unknown) =>
      this.engines && strings(classes) && strings(ids) && strings(exceptions)
        ? this.engines.all.hiddenClassIdSelectors(classes, ids, exceptions)
        : []
    )
    this.attach(session)
    void this.load()
    setInterval(() => void this.refreshIfStale(), CHECK_EVERY_MS).unref()
  }

  /** Also block in another session (the private one), with the same engines and exceptions. */
  attach(session: Session): void {
    if (this.sessions.includes(session)) return
    this.sessions.push(session)
    session.registerPreloadScript({
      type: 'frame',
      filePath: join(__dirname, '../preload/adblock.js')
    })
    this.apply(session)
  }

  configure(config: Config): void {
    const was = this.config.adblock
    this.config = config
    if (was !== config.adblock) for (const s of this.sessions) this.apply(s)
  }

  /** Requests blocked on the page currently in this WebContents. */
  blockedOn(id: number): number {
    const wc = webContents.fromId(id)
    const seen = this.blocked.get(id)
    return wc && !wc.isDestroyed() && seen?.page === wc.getURL() ? seen.count : 0
  }

  /** Whether the blocker is at work on a page's site, and whether it may hide the page's elements there. */
  siteState(pageUrl: string): { blocking: boolean; cosmetic: boolean } {
    return {
      blocking: this.config.adblock && !this.listed(pageUrl, this.config.adblockOffSites),
      cosmetic: !this.listed(pageUrl, this.config.adblockCosmeticOffSites)
    }
  }

  // ---- engines ----

  private async load(): Promise<void> {
    try {
      this.use(unpackEngines(await fs.readFile(this.file)))
    } catch (err) {
      // missing, damaged, or from another engine version: nothing to block with until built
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn('[adblock] saved engine unusable:', err)
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

  /**
   * Download Brave's catalog, its lists and the scriptlet resources, build the engines off the main thread
   * (see adblockWorker.ts), then save and use them. Downloads go through Chromium's network stack (net.fetch),
   * like every other request the browser makes, so they follow the system's proxy and certificates.
   */
  private async refresh(): Promise<void> {
    if (this.building) return
    this.building = true
    try {
      const lists = pickLists(JSON.parse(await download(CATALOG_URL)) as CatalogEntry[])
      const [texts, resources] = await Promise.all([
        Promise.all(lists.map((l) => download(l.url))),
        download(RESOURCES_URL).catch(async (err: unknown) => {
          console.warn('[adblock] using bundled resources:', err)
          return fs.readFile(bundledResources, 'utf8')
        })
      ])
      const input: BuildInput = { lists, texts, resources }
      const built = await new Promise<BuiltEngines>((resolve, reject) => {
        const worker = buildEngine({ workerData: input })
        worker.once('message', (msg: BuiltEngines | string) => {
          void worker.terminate()
          if (typeof msg === 'string') reject(new Error(msg))
          else resolve(msg)
        })
        worker.once('error', reject)
        worker.once('exit', (code) => reject(new Error(`engine worker exited (${code})`)))
      })
      const data = packEngines([built.all, built.firstParty, resources])
      // Load and check it before saving, so a bad build never replaces a good file.
      this.use(unpackEngines(data))
      const tmp = this.file + '.tmp'
      await fs.writeFile(tmp, data)
      await fs.rename(tmp, this.file)
    } catch (err) {
      console.error('[adblock] list update failed:', err)
    } finally {
      this.building = false
    }
  }

  /** Load engines from their saved bytes, check them, and put them to work. Throws if the check fails. */
  private use([all, firstParty, resources]: [ArrayBuffer, ArrayBuffer, string]): void {
    const parsed = JSON.parse(resources) as unknown[]
    const load = (data: ArrayBuffer): Engine => {
      const engine = new Engine(new FilterSet())
      engine.deserialize(data)
      engine.useResources(parsed)
      return engine
    }
    const next = { all: load(all), firstParty: load(firstParty) }
    for (const c of CANARY) {
      if (next.all.check(c.url, c.source, c.type, 'GET') !== c.block) {
        throw new Error(`engine ${c.block ? 'let through' : 'blocked'} ${c.url}`)
      }
    }
    this.engines = next
  }

  // ---- requests ----

  /** One listener per session, only while blocking is on (Electron allows one onBeforeRequest per session). */
  private apply(session: Session): void {
    session.webRequest.onBeforeRequest(
      this.config.adblock ? (details, callback) => callback(this.onRequest(details) ?? {}) : null
    )
  }

  private onRequest(details: OnBeforeRequestListenerDetails): Electron.CallbackResponse | null {
    const engines = this.engines
    if (!engines || !/^(https?|wss?):/.test(details.url)) return null
    const page = pageOf(details.webContentsId)
    if (page && this.listed(page, this.config.adblockOffSites)) return null
    const type = requestType(details.resourceType)
    if (type === 'document') return null

    if (isYouTubeAdRequest(details.url)) {
      this.count(details.webContentsId)
      return { cancel: true }
    }

    const source = sourceOf(details, type) || page || details.url
    // Brave blocks aggressively wherever YouTube is the one asking.
    const aggressive =
      this.config.adblockAggressive ||
      (!!page && this.listed(page, this.config.adblockAggressiveSites)) ||
      isYouTubeUrl(source)
    const verdict = decide(
      { url: details.url, method: details.method, type },
      sameSite(details.url, source),
      aggressive,
      (which) => engines[which].check(details.url, source, type, details.method, true)
    )
    if (!verdict) return null
    if (verdict.blocked) this.count(details.webContentsId)
    return verdict.response
  }

  private count(id: number | undefined): void {
    const wc = id ? webContents.fromId(id) : undefined
    if (!id || !wc || wc.isDestroyed()) return
    const page = wc.getURL()
    const seen = this.blocked.get(id)
    if (seen?.page === page) seen.count++
    else this.blocked.set(id, { page, count: 1 })
  }

  // ---- pages ----

  /** What a frame's preload does at document start; null when the blocker has nothing to do there. */
  private cosmeticStart(frame: WebFrameMain | null): CosmeticStart | null {
    const engines = this.engines
    if (!engines || !frame || !this.config.adblock || !/^https?:/.test(frame.url)) return null
    // A frame follows the exceptions of the page it is in.
    const page = frame.top?.url || frame.url
    if (this.listed(page, this.config.adblockOffSites)) return null
    if (this.listed(page, this.config.adblockCosmeticOffSites)) return null
    const r = engines.all.urlCosmeticResources(frame.url)
    const host = getHostname(frame.url) ?? ''
    return {
      scriptlet: r.injected_script,
      hide: r.hide_selectors,
      procedural: r.procedural_actions,
      exceptions: r.exceptions,
      generic: !r.generichide,
      standard: !(
        this.config.adblockAggressive || this.listed(page, this.config.adblockAggressiveSites)
      ),
      site: getDomain(host, { allowPrivateDomains: true }) ?? host
    }
  }

  private listed(pageUrl: string, sites: readonly string[]): boolean {
    const key = siteKey(pageUrl)
    return !!key && siteListed(key, sites)
  }
}

const DOWNLOAD_TIMEOUT_MS = 60_000

/** A list or file as text; a failed response throws (else a missing list would be read as rules). */
async function download(url: string): Promise<string> {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`${res.status} ${url}`)
  }
  return res.text()
}

/** A page can be gone by the time its last requests arrive, and a destroyed WebContents throws when asked. */
function pageOf(id: number | undefined): string {
  const wc = id ? webContents.fromId(id) : undefined
  return wc && !wc.isDestroyed() ? wc.getURL() : ''
}

/**
 * Who asked for a request: the frame that made it, or for a frame being loaded, the page around it. A frame
 * can be gone or mid-navigation, so anything it cannot answer falls back to the page.
 */
function sourceOf(details: OnBeforeRequestListenerDetails, type: string): string {
  try {
    const frame = details.frame
    if (!frame || frame.isDestroyed()) return ''
    return (type === 'subdocument' ? frame.parent?.url : frame.url) || ''
  } catch {
    return ''
  }
}

function strings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string')
}
