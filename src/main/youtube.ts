import { ipcMain, webContents, type Session, type WebContents, type WebFrameMain } from 'electron'
import { join } from 'path'
import {
  YOUTUBE_MATCHES,
  YOUTUBE_OFF,
  isYouTubeUrl,
  youtubeConfig,
  type YouTubeConfig,
  type YouTubeStart
} from '@shared/youtube'
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
  /** Whether the graphics card decodes AV1 (see probeAv1); assumed until known. */
  private av1Hardware = true

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
    return youtubeConfig(this.settings.get(), this.adblock.siteState(page), this.av1Hardware)
  }

  /**
   * Ask a page of ours whether AV1 decodes in hardware here (power efficient: the graphics card does it). YouTube
   * pages that start after the answer follow it.
   * ponytail: asked once per start; a YouTube page restored before the answer can still get AV1 until it reloads.
   */
  probeAv1(wc: WebContents): void {
    wc.executeJavaScript(
      `navigator.mediaCapabilities.decodingInfo({ type: 'media-source', video: { contentType: 'video/mp4; codecs="av01.0.08M.08"', width: 1280, height: 720, bitrate: 2000000, framerate: 30 } }).then((r) => r.powerEfficient)`
    )
      .then((hw: unknown) => {
        this.av1Hardware = hw !== false
      })
      .catch(() => undefined)
  }

  private start(frame: WebFrameMain | null): YouTubeStart | null {
    if (!frame || !isYouTubeUrl(frame.url)) return null
    const cfg = this.config(frame)
    if (!cfg) return null
    return { cfg }
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
