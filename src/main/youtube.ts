import { ipcMain, webContents, type Session, type WebContents, type WebFrameMain } from 'electron'
import { join } from 'path'
import {
  ALL_HARDWARE,
  HW_DECODE_PROBE,
  YOUTUBE_MATCHES,
  YOUTUBE_OFF,
  isYouTubeUrl,
  youtubeConfig,
  type HwDecode,
  type YouTubeConfig,
  type YouTubeStart
} from '@shared/youtube'
import type { Adblock } from './adblock'
import type { SettingsStore } from './settings'
import { JsonStore } from './store'

/**
 * Puts the YouTube preload (src/preload/youtube.ts) into YouTube's frames, in every session it is attached
 * to, and answers it: each frame asks once at document start what to do, and is told again whenever a
 * setting or the site's ad blocker exception changes, so nothing waits for a reload to turn off.
 *
 * The preload is registered for YouTube's own addresses only, so no other site pays anything for it.
 */
export class YouTube {
  private sessions = new Set<Session>()
  /**
   * The codecs the graphics hardware decodes (see probeDecoders), as found on the last start: known before the first
   * YouTube page of this one loads (a restored tab loads before the window's page can answer). All, until first known.
   */
  private hw = new JsonStore<HwDecode>('hw-decode', ALL_HARDWARE)

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
    return youtubeConfig(this.settings.get(), this.adblock.siteState(page), {
      av1: this.hw.value.av1 !== false,
      vp9: this.hw.value.vp9 !== false
    })
  }

  /**
   * Ask a page of ours which codecs decode in hardware here (see autoCodec). YouTube pages that start after the
   * answer follow it, and the next start has it from the first page on (a new graphics card or driver is caught up
   * with one start late).
   */
  probeDecoders(wc: WebContents): void {
    wc.executeJavaScript(HW_DECODE_PROBE)
      .then((r: unknown) => {
        if (!Array.isArray(r)) return
        const hw = { av1: r[0] !== false, vp9: r[1] !== false }
        if (hw.av1 === this.hw.value.av1 && hw.vp9 === this.hw.value.vp9) return
        this.hw.value = hw
        this.hw.save()
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
