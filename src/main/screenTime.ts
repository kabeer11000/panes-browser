import { ipcMain, powerMonitor, type BrowserWindow } from 'electron'
import {
  addTime,
  cleanScreenTime,
  dayOf,
  emptyScreenTime,
  grantMore,
  prune,
  setLimit,
  siteOf,
  summarize,
  timeLeft,
  type ScreenSummary,
  type ScreenTime
} from '@shared/screenTime'
import { JsonStore } from './store'

/**
 * Screen time (shared/screenTime.ts), counted here: every TICK, the site of the page in front gets the time, while
 * Panes is the window in use and the person is there (input within IDLE_S, or a video playing). Private and Tor tabs
 * are never counted. A site past its daily limit has its tab sent to the "time's up" page.
 */
const TICK_MS = 5000
const IDLE_S = 120

interface Deps {
  win: BrowserWindow
  /** The web page in front of the person (null when none: the board with no page open, a private tab...). */
  inFront: () => { id: number; url: string; playing: boolean } | null
  navigateTab: (id: number, url: string) => boolean
  /** Each tick's time, as it is counted (usage statistics). */
  onTime?: (site: string, seconds: number) => void
}

export class ScreenTimeService {
  private store = new JsonStore<ScreenTime>('screen-time', emptyScreenTime())
  private timer: NodeJS.Timeout | null = null
  /** The tab sent to the time's-up page last, so it is not sent again every tick while it shows it. */
  private stopped = new Map<number, string>()

  constructor(private d: Deps) {
    this.store.value = prune(cleanScreenTime(this.store.value), dayOf(Date.now()))
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    const w = this.d.win
    if (w.isDestroyed() || !w.isVisible() || w.isMinimized() || !w.isFocused()) return
    const f = this.d.inFront()
    if (!f) return
    if (!f.playing && powerMonitor.getSystemIdleTime() > IDLE_S) return
    const site = siteOf(f.url)
    if (!site) return
    const today = dayOf(Date.now())
    let st = this.store.value
    if (!st.days[today]) st = prune(st, today) // a new day: old ones go
    this.store.value = addTime(st, today, site, TICK_MS / 1000)
    this.d.onTime?.(site, TICK_MS / 1000)
    this.store.save()
    const left = timeLeft(this.store.value, today, site)
    if (left !== null && left <= 0 && this.stopped.get(f.id) !== f.url) {
      this.stopped.set(f.id, f.url)
      this.d.navigateTab(f.id, timesUpUrl(site, f.url))
    }
  }

  summary(): ScreenSummary {
    return summarize(this.store.value, dayOf(Date.now()))
  }

  setLimit(site: string, minutes: number | null): void {
    this.store.value = setLimit(this.store.value, site, minutes)
    this.store.save()
  }

  more(site: string): void {
    this.store.value = grantMore(this.store.value, dayOf(Date.now()), site)
    this.store.save()
    for (const [id, url] of this.stopped) if (siteOf(url) === site) this.stopped.delete(id)
  }

  clear(): void {
    this.store.value = { ...emptyScreenTime(), limits: this.store.value.limits }
    this.store.save()
  }
}

export const timesUpUrl = (site: string, back: string): string =>
  `panes://screen-time/?limit=${encodeURIComponent(site)}&back=${encodeURIComponent(back)}`

const SITE_RE = /^[a-z0-9.-]{1,253}$/

/** The screen time page's questions; only that page may ask. */
export function registerScreenTimeIpc(svc: ScreenTimeService): void {
  const mine = (e: Electron.IpcMainInvokeEvent): boolean =>
    !!e.senderFrame?.url.startsWith('panes://screen-time')
  ipcMain.handle('int:screen-time', (e) => (mine(e) ? svc.summary() : null))
  ipcMain.handle('int:screen-time-limit', (e, site: unknown, minutes: unknown) => {
    if (!mine(e) || typeof site !== 'string' || !SITE_RE.test(site)) return false
    svc.setLimit(site, typeof minutes === 'number' ? minutes : null)
    return true
  })
  ipcMain.handle('int:screen-time-more', (e, site: unknown) => {
    if (!mine(e) || typeof site !== 'string' || !SITE_RE.test(site)) return false
    svc.more(site)
    return true
  })
  ipcMain.handle('int:screen-time-clear', (e) => {
    if (!mine(e)) return false
    svc.clear()
    return true
  })
}
