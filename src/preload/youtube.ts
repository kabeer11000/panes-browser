import { ipcRenderer, webFrame } from 'electron'
import {
  youtubeCss,
  youtubeScript,
  youtubeUpdate,
  type YouTubeConfig,
  type YouTubeStart
} from '../shared/youtube'

/**
 * Runs in YouTube's frames only (see src/main/youtube.ts), at document start, before any of the page's own
 * scripts. webFrame.executeJavaScript runs code in the page's own world, which is where the player's data has
 * to be intercepted; a <script> element would be refused by YouTube's content security policy.
 */

const run = (code: string): void => {
  webFrame.executeJavaScript(code).catch((err: unknown) => console.warn('[panes youtube]', err))
}

const start = ipcRenderer.sendSync('youtube:start') as YouTubeStart | null

if (start) {
  // Ours first (the baseline that does not depend on the lists), then the lists' scriptlets.
  // A random event name, so the page cannot easily find or fake the channel updates arrive on.
  const channel = `panes-yt-${Math.random().toString(36).slice(2)}`
  run(youtubeScript(start.cfg, channel))
  for (const script of start.scriptlets) run(script)

  // An author sheet, not a user one: Electron cannot take a user sheet back out (tested on 44), and a setting
  // switched off has to show what it hid. Its rules are all `!important`: only an `!important` rule of
  // YouTube's own could undo one.
  let sheet: string | null = null
  const style = (cfg: YouTubeConfig): void => {
    if (sheet) webFrame.removeInsertedCSS(sheet)
    const css = youtubeCss(cfg)
    sheet = css ? webFrame.insertCSS(css) : null
  }
  style(start.cfg)

  ipcRenderer.on('youtube:config', (_e, cfg: YouTubeConfig) => {
    style(cfg)
    run(youtubeUpdate(cfg, channel))
  })
}
