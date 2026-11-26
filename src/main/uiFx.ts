import { app, webContents, type WebContents } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'

/**
 * How Panes' own pages look: efficient mode (`data-fx`), frosted glass (`data-glass`), tooltips (`data-tips`) and shortcuts in menus (`data-keys`), stamped on the root of every
 * one of its pages, whichever window or view it is in (the main window, panes:// pages, popovers, the panel, the dock,
 * print...), so one setting means the same everywhere. styles.css turns these into --glass-alpha / --glass-blur.
 * Each page also keeps them for its next start (public/boot.js reads them before the first paint).
 */
export function registerUiFx(
  state: () => { fx: 'low' | 'full'; glass: boolean; tips: boolean; keys: boolean }
): {
  refresh: () => void
} {
  const base = (
    process.env['ELECTRON_RENDERER_URL'] ?? pathToFileURL(join(__dirname, '../renderer')).href
  ).toLowerCase()
  const isUi = (wc: WebContents): boolean => {
    if (wc.isDestroyed()) return false
    const url = wc.getURL().toLowerCase()
    return url.startsWith(base) || url.startsWith('panes://')
  }
  const apply = (wc: WebContents): void => {
    if (!isUi(wc)) return
    const { fx, glass, tips, keys } = state()
    const g = glass ? 'on' : 'off'
    const t = tips ? 'on' : 'off'
    const k = keys ? 'on' : 'off'
    void wc
      .executeJavaScript(
        `(() => { const d = document.documentElement.dataset; d.fx = '${fx}'; d.glass = '${g}'; d.tips = '${t}'; d.keys = '${k}';` +
          ` try { localStorage.setItem('panes:fx', '${fx}'); localStorage.setItem('panes:glass', '${g}');` +
          ` localStorage.setItem('panes:tips', '${t}'); localStorage.setItem('panes:keys', '${k}') } catch (e) {} })()`
      )
      .catch(() => undefined)
  }
  const watch = (wc: WebContents): void => void wc.on('dom-ready', () => apply(wc))
  webContents.getAllWebContents().forEach(watch) // the main window's, made before this
  app.on('web-contents-created', (_e, wc) => watch(wc))
  return { refresh: () => webContents.getAllWebContents().forEach(apply) }
}
