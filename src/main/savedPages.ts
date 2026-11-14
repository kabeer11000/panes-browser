import { app, session, WebContentsView, type Session, type WebContents } from 'electron'
import { createHash } from 'crypto'
import { mkdirSync } from 'fs'
import { rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { prunePlan, SAVED_FRESH_MS, SAVED_MAX_BYTES, type SavedPage } from '@shared/savedPages'
import { JsonStore } from './store'

/**
 * Pages saved to disk as they leave the screen (one MHTML file each: the page as drawn, its pictures and styles in
 * it), so a tab opened again after being unloaded, or after a restart, shows its page at once, from disk, readable
 * and scrollable where it was left, while the live page loads behind it (TabManager swaps it in once it has drawn).
 * A saved page runs no script (Chromium never runs any in one), reaches no network and goes nowhere. Private and Tor
 * tabs are never saved.
 */
export class SavedPages {
  private store = new JsonStore<Record<string, SavedPage>>('saved-pages', {})
  private dir = join(app.getPath('userData'), 'saved-pages')
  private saving = new Set<string>()
  private offline: Session | null = null

  has = (url: string): boolean => !!this.store.value[url]

  /** Saved recently enough that leaving the screen again need not save it whole (unless the page changed). */
  fresh = (url: string): boolean => Date.now() - (this.store.value[url]?.at ?? 0) < SAVED_FRESH_MS

  /**
   * Save the page `wc` shows now as `url`'s copy, or (`whole` false: saved a moment ago and unchanged) only note where
   * it is scrolled to. Quiet on failure: the tab just has no copy.
   */
  async save(wc: WebContents, url: string, whole = true): Promise<void> {
    if (!/^https?:/i.test(url) || this.saving.has(url) || wc.isDestroyed()) return
    this.saving.add(url)
    try {
      const y = Number(await wc.executeJavaScript('Math.round(scrollY)', false).catch(() => 0)) || 0
      const had = this.store.value[url]
      if (!whole && had) {
        if (had.y !== y) {
          had.y = y
          this.store.save()
        }
        return
      }
      mkdirSync(this.dir, { recursive: true })
      const file = createHash('sha1').update(url).digest('hex') + '.mhtml'
      const tmp = join(this.dir, file.replace(/\.mhtml$/, '.part.mhtml')) // (Chromium sets the extension of a name it does not know)
      await wc.savePage(tmp, 'MHTML')
      const { size } = await stat(tmp)
      if (size > SAVED_MAX_BYTES) return void (await rm(tmp, { force: true }))
      await rename(tmp, join(this.dir, file))
      this.store.value[url] = { file, at: Date.now(), bytes: size, y }
      this.store.save()
    } catch {
      // the page went away or would not serialise
    } finally {
      this.saving.delete(url)
    }
  }

  /**
   * A view showing `url`'s saved copy, or null. Not in any window yet; `onReady` once it has drawn and is scrolled
   * where the page was left. `scrolled()` says where it is now (the person may have scrolled it meanwhile).
   */
  open(
    url: string,
    onReady: () => void
  ): { view: WebContentsView; scrolled: () => Promise<number | null> } | null {
    const p = this.store.value[url]
    if (!p) return null
    const view = new WebContentsView({
      webPreferences: { session: this.session(), sandbox: true }
    })
    const wc = view.webContents
    wc.on('will-navigate', (e) => e.preventDefault()) // a link in it waits for the live page
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)
    // its own scripts never run, so it is scrolled from outside, through the debugger
    const evaluate = async (expression: string): Promise<unknown> => {
      if (wc.isDestroyed()) return null
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      const r = await wc.debugger.sendCommand('Runtime.evaluate', {
        expression,
        returnByValue: true
      })
      return r?.result?.value
    }
    wc.once('did-finish-load', () => {
      evaluate(
        `document.scrollingElement && (document.scrollingElement.style.scrollBehavior = 'auto', window.scrollTo(0, ${p.y}))`
      )
        .catch(() => undefined)
        .finally(() => !wc.isDestroyed() && onReady())
    })
    wc.loadURL(pathToFileURL(join(this.dir, p.file)).href).catch(() => undefined)
    return {
      view,
      scrolled: async () => {
        const v = await evaluate('Math.round(scrollY)').catch(() => null)
        return typeof v === 'number' ? v : null
      }
    }
  }

  /** Keep only the pages of these addresses (the tabs' own), within the size budget. */
  prune(keep: ReadonlySet<string>): void {
    const gone = prunePlan(this.store.value, keep)
    if (gone.length === 0) return
    for (const url of gone) {
      const p = this.store.value[url]
      delete this.store.value[url]
      if (p) void rm(join(this.dir, p.file), { force: true }).catch(() => undefined)
    }
    this.store.save()
  }

  /** Clearing browsing data: every saved page goes. */
  async clear(): Promise<void> {
    this.store.value = {}
    this.store.save()
    await rm(this.dir, { recursive: true, force: true }).catch(() => undefined)
  }

  /** In memory only, and nothing but the saved file itself loads: no request leaves for the network. */
  private session(): Session {
    if (!this.offline) {
      this.offline = session.fromPartition('panes-saved-pages')
      this.offline.webRequest.onBeforeRequest((d, cb) =>
        cb({ cancel: !/^(file|data|blob):/i.test(d.url) })
      )
    }
    return this.offline
  }
}
