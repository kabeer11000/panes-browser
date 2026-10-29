import { is } from '@electron-toolkit/utils'
import {
  BrowserWindow,
  ipcMain,
  screen,
  WebContentsView,
  type IpcMainEvent,
  type WebFrameMain
} from 'electron'
import { join } from 'path'
import type { PipState } from '../shared/types'

const POLL_MS = 250
const START_WIDTH = 480
const MIN_WIDTH = 260
const MARGIN = 24
const SKIP_CLAMP = 1e9

// Page-side helpers. The chosen <video> is tagged so every later command finds the same element.
const VIDEOS = `[...document.querySelectorAll('video')]
  .filter((v) => v.videoWidth > 0)
  .sort((a, b) => {
    const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height }
    return Number(!b.paused) - Number(!a.paused) || area(b) - area(a)
  })`
const FIND = `(() => { const v = ${VIDEOS}[0]; if (!v) return null;
  const r = v.getBoundingClientRect();
  return { playing: !v.paused, area: r.width * r.height, w: v.videoWidth, h: v.videoHeight } })()`
const GRAB = `(() => { const v = ${VIDEOS}[0]; if (!v) return false;
  document.querySelectorAll('video[data-panes-pip]').forEach((x) => x.removeAttribute('data-panes-pip'));
  v.setAttribute('data-panes-pip', '1');
  v.requestFullscreen().catch(() => {});
  return true })()`
const STATE = `(() => { const v = document.querySelector('video[data-panes-pip]'); if (!v) return null;
  return { playing: !v.paused, current: v.currentTime,
    duration: Number.isFinite(v.duration) ? v.duration : 0, muted: v.muted, w: v.videoWidth, h: v.videoHeight } })()`
const RELEASE = `(() => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.querySelectorAll('video[data-panes-pip]').forEach((x) => x.removeAttribute('data-panes-pip')) })()`
const withVideo = (body: string): string =>
  `(() => { const v = document.querySelector('video[data-panes-pip]'); if (!v) return; ${body} })()`

interface Host {
  id: number
  view: WebContentsView
}

interface Options {
  mainWin: BrowserWindow
  /** Radius to give the page view again when it returns to the main window. */
  viewRadius: number
  onChange: () => void
  onReturn: (tabId: number) => void
}

/**
 * Picture in picture. Chromium's own PiP window is not available to Electron, so the tab's page
 * view itself moves into a small always-on-top window with the video made fullscreen inside it.
 * Playback is untouched (no mirroring); hover controls live in a transparent view on top.
 */
export class PipController {
  private win: BrowserWindow | null = null
  private controls: WebContentsView | null = null
  private host: Host | null = null
  private frame: WebFrameMain | null = null
  private timer: NodeJS.Timeout | null = null
  private drag: { cursor: { x: number; y: number }; origin: { x: number; y: number } } | null = null

  constructor(private opts: Options) {
    const fromControls = (e: IpcMainEvent): boolean =>
      !!this.controls && e.sender === this.controls.webContents
    const on = (channel: string, fn: (...args: unknown[]) => void): void => {
      ipcMain.on(channel, (e, ...args) => fromControls(e) && fn(...args))
    }
    on('pip:play-pause', () => this.run(withVideo('v.paused ? v.play() : v.pause()')))
    on('pip:seek', (t) => this.run(withVideo(`v.currentTime = ${Number(t) || 0}`)))
    on('pip:skip', (d) =>
      this.run(
        withVideo(
          `v.currentTime = Math.max(0, Math.min(v.duration || ${SKIP_CLAMP}, v.currentTime + ${Number(d) || 0}))`
        )
      )
    )
    on('pip:mute', () => this.run(withVideo('v.muted = !v.muted')))
    on('pip:close', () => this.stop())
    on('pip:back', () => {
      const id = this.host?.id
      this.stop()
      if (id !== undefined) this.opts.onReturn(id)
    })
    on('pip:drag', (phase) => {
      if (!this.win) return
      const cursor = screen.getCursorScreenPoint()
      if (phase === 'start') {
        const [x, y] = this.win.getPosition()
        this.drag = { cursor, origin: { x, y } }
      } else if (phase === 'move' && this.drag) {
        this.win.setPosition(
          Math.round(this.drag.origin.x + cursor.x - this.drag.cursor.x),
          Math.round(this.drag.origin.y + cursor.y - this.drag.cursor.y)
        )
      } else {
        this.drag = null
      }
    })
  }

  /** Dev aid: what the floating window and the video look like right now. */
  async debugInfo(): Promise<unknown> {
    if (!this.win || !this.frame) return { active: false }
    const page = await this.frame
      .executeJavaScript(
        `(() => { const v = document.querySelector('video[data-panes-pip]'); return v ? { fullscreen: !!document.fullscreenElement, paused: v.paused, w: v.videoWidth, h: v.videoHeight, t: v.currentTime } : null })()`
      )
      .catch(() => null)
    const [w, h] = this.win.getContentSize()
    return { active: true, size: [w, h], onTop: this.win.isAlwaysOnTop(), tab: this.host?.id, page }
  }

  /** The tab currently in picture in picture, if any. */
  get tabId(): number | null {
    return this.host?.id ?? null
  }

  private run(code: string): void {
    this.frame?.executeJavaScript(code, true).catch(() => {})
  }

  /** The frame holding the best video: playing first, then largest. Null when the page has none. */
  private async findFrame(
    view: WebContentsView
  ): Promise<{ frame: WebFrameMain; w: number; h: number } | null> {
    let best: { frame: WebFrameMain; w: number; h: number; score: number } | null = null
    for (const frame of view.webContents.mainFrame.framesInSubtree) {
      try {
        const v = (await frame.executeJavaScript(FIND)) as {
          playing: boolean
          area: number
          w: number
          h: number
        } | null
        if (!v) continue
        const score = (v.playing ? 1e12 : 0) + v.area
        if (!best || score > best.score) best = { frame, w: v.w, h: v.h, score }
      } catch {
        // a frame that is gone or not scriptable has no usable video
      }
    }
    return best
  }

  async start(host: Host): Promise<boolean> {
    if (this.host) this.stop()
    const found = await this.findFrame(host.view)
    if (!found) return false

    const { mainWin } = this.opts
    const aspect = found.w / found.h || 16 / 9
    const width = START_WIDTH
    const height = Math.round(width / aspect)
    const area = screen.getDisplayMatching(mainWin.getBounds()).workArea

    const win = new BrowserWindow({
      width,
      height,
      x: area.x + area.width - width - MARGIN,
      y: area.y + area.height - height - MARGIN,
      frame: false,
      alwaysOnTop: true,
      resizable: true,
      minWidth: MIN_WIDTH,
      minHeight: Math.round(MIN_WIDTH / aspect),
      maximizable: false,
      fullscreenable: false,
      backgroundColor: '#000000',
      hasShadow: true,
      title: 'Picture in picture',
      show: false
    })
    win.setAspectRatio(aspect)
    win.setAlwaysOnTop(true, 'floating')

    const controls = new WebContentsView({
      webPreferences: { sandbox: true, preload: join(__dirname, '../preload/pip.js') }
    })
    controls.setBackgroundColor('#00000000')

    // Move the page itself into the floating window, then lay a transparent controls view on top.
    mainWin.contentView.removeChildView(host.view)
    host.view.setBorderRadius(0)
    win.contentView.addChildView(host.view)
    win.contentView.addChildView(controls)
    const layout = (): void => {
      const [w, h] = win.getContentSize()
      host.view.setBounds({ x: 0, y: 0, width: w, height: h })
      controls.setBounds({ x: 0, y: 0, width: w, height: h })
    }
    layout()
    host.view.setVisible(true)
    win.on('resize', layout)
    win.on('closed', () => this.teardown(false))

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl) void controls.webContents.loadURL(`${devUrl}/pip.html`)
    else void controls.webContents.loadFile(join(__dirname, '../renderer/pip.html'))

    this.win = win
    this.controls = controls
    this.host = host
    this.frame = found.frame
    win.show()

    // Fullscreen needs a user gesture; executeJavaScript can stand in for one.
    await found.frame.executeJavaScript(GRAB, true).catch(() => {})
    this.timer = setInterval(() => void this.poll(), POLL_MS)
    this.opts.onChange()
    return true
  }

  /** Re-enter fullscreen after Escape or a site script left it, so the video keeps filling the window. */
  refullscreen(): void {
    this.run(withVideo('if (!document.fullscreenElement) v.requestFullscreen().catch(() => {})'))
  }

  private async poll(): Promise<void> {
    if (!this.frame || !this.controls) return
    try {
      const state = (await this.frame.executeJavaScript(STATE)) as PipState | null
      if (!state) return this.stop() // the video is gone (the page navigated)
      this.controls.webContents.send('pip:state', state)
    } catch {
      this.stop()
    }
  }

  /** Put the page back in the main window and close the floating one. */
  stop(): void {
    this.teardown(true)
  }

  private teardown(closeWindow: boolean): void {
    const host = this.host
    if (!host) return
    const { win, controls } = this
    this.host = null
    this.win = null
    this.controls = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.run(RELEASE)
    this.frame = null

    if (win && !win.isDestroyed()) win.contentView.removeChildView(host.view)
    host.view.setBorderRadius(this.opts.viewRadius)
    if (!this.opts.mainWin.isDestroyed()) this.opts.mainWin.contentView.addChildView(host.view)
    if (win && !win.isDestroyed() && controls) {
      win.contentView.removeChildView(controls)
      controls.webContents.close()
    }
    if (closeWindow && win && !win.isDestroyed()) win.close()
    this.opts.onChange()
  }
}
