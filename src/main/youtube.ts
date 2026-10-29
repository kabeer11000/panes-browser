import { ipcMain, webContents, type Session, type WebFrameMain } from 'electron'
import { join } from 'path'
import {
  YOUTUBE_MATCHES,
  YOUTUBE_OFF,
  isYouTubeUrl,
  youtubeConfig,
  type YouTubeConfig,
  type YouTubeStart
} from '../shared/youtube'
import type { Adblock } from './adblock'
import type { SettingsStore } from './settings'

/**
 * Puts the YouTube preload (src/preload/youtube.ts) into YouTube's frames, in every session it is attached
 * to, and answers it: each frame asks once at document start what to do, and is told again whenever a
 * setting or the site's ad blocker exception changes, so nothing waits for a reload to turn off.
 *
 * The preload is registered for YouTube's own addresses only, so no other site pays anything for it.
 */
export class YouTube {
  private sessions = new Set<Session>()

  constructor(
    private settings: SettingsStore,
    private adblock: Adblock
  ) {
    // Synchronous on purpose: the frame must have its answer before YouTube's first script runs.
    ipcMain.on('youtube:start', (e) => {
      try {
        e.returnValue = this.start(e.senderFrame)
      } catch (err) {
        console.error('[youtube] start failed:', err)
        e.returnValue = null // the frame is blocked until it gets a value, whatever happens
      }
    })
  }

  attach(session: Session): void {
    if (this.sessions.has(session)) return
    this.sessions.add(session)
    session.registerPreloadScript({
      type: 'frame',
      filePath: join(__dirname, '../preload/youtube.js'),
      matches: YOUTUBE_MATCHES
    })
  }

  /** The config for a frame, from its top page's site (an embed follows the exceptions of the page it is on). */
  private config(frame: WebFrameMain): YouTubeConfig | null {
    const page = frame.top?.url || frame.url
    return youtubeConfig(this.settings.get(), this.adblock.siteState(page))
  }

  private start(frame: WebFrameMain | null): YouTubeStart | null {
    if (!frame || !isYouTubeUrl(frame.url)) return null
    const cfg = this.config(frame)
    if (!cfg) return null
    const scriptlets = cfg.ads && cfg.cosmetic ? this.adblock.youtubeScriptlets(frame.url) : []
    return { cfg, scriptlets }
  }

  /** After a settings change: tell every YouTube frame already running what it should do now. */
  update(): void {
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || !this.sessions.has(wc.session)) continue
      for (const frame of wc.mainFrame.framesInSubtree) {
        if (frame.isDestroyed() || !isYouTubeUrl(frame.url)) continue
        frame.send('youtube:config', this.config(frame) ?? YOUTUBE_OFF)
      }
    }
  }
}
