import type { WebContents } from 'electron'

/** CSS variables and scheme that make a popover view wear the window's colours (see chromeVars). */
export interface ChromeTheme {
  scheme: 'dark' | 'light'
  vars: Record<string, string>
}

let source: (() => ChromeTheme) | null = null

/** Where the current theme comes from: the active space and the settings, set once at start-up. */
export function setChromeThemeSource(fn: () => ChromeTheme): void {
  source = fn
}

/** Paint the colours into a popover view: now if it has loaded, else as soon as it does. */
export function paintView(wc: WebContents): void {
  const apply = (): void => {
    if (wc.isDestroyed() || !source) return
    const { scheme, vars } = source()
    const css = Object.entries(vars)
      .map(([k, v]) => `root.style.setProperty(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
      .join('')
    void wc
      .executeJavaScript(
        `(() => { const root = document.documentElement; root.dataset.scheme = ${JSON.stringify(scheme)}; ${css} })()`
      )
      .catch(() => undefined)
  }
  if (wc.isLoading()) wc.once('did-finish-load', apply)
  else apply()
}
