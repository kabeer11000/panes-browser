import { app, type Session } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { ElectronBlocker } from '@ghostery/adblocker-electron'

/** Network-level ads + tracker blocking. The engine is cached on disk; failure to load is non-fatal. */
export class Adblock {
  private ready: Promise<ElectronBlocker | null>
  private active = false

  constructor(private session: Session) {
    this.ready = ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: join(app.getPath('userData'), 'adblock-engine.bin'),
      read: fs.readFile,
      write: fs.writeFile
    }).catch((err) => {
      console.error('[adblock] failed to load:', err)
      return null
    })
  }

  async set(enabled: boolean): Promise<void> {
    const blocker = await this.ready
    if (!blocker || enabled === this.active) return
    this.active = enabled
    if (enabled) blocker.enableBlockingInSession(this.session)
    else blocker.disableBlockingInSession(this.session)
  }
}
