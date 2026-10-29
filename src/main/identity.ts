import { release } from 'os'
import type { Session, WebContents } from 'electron'
import { CHROME_OBJECT_SCRIPT, chromeMetadata, type Brand } from '../shared/identity'

const header = (list: Brand[]): string =>
  list.map((b) => `"${b.brand}";v="${b.version}"`).join(', ')

/**
 * The same story in request headers, for every request of a session: the first request of a popup or a
 * new tab goes out before any per-tab override can apply, and it is the one that decides a sign-in.
 */
export function rewriteClientHints(session: Session, userAgent: string): void {
  const m = chromeMetadata(userAgent, process.platform, release(), process.arch)
  if (!m) return
  session.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = details.requestHeaders
    for (const name of Object.keys(headers)) {
      const key = name.toLowerCase()
      if (key === 'sec-ch-ua') headers[name] = header(m.brands)
      else if (key === 'sec-ch-ua-full-version-list') headers[name] = header(m.fullVersionList)
    }
    callback({ requestHeaders: headers })
  })
}

/**
 * Make a tab describe itself as Google Chrome, consistently: the user agent string, the client hints
 * (headers and `navigator.userAgentData`) and the `window.chrome` object. Sign-in pages compare them,
 * and a Chrome user agent beside Chromium-only brands gets "this browser may not be secure".
 *
 * Uses the DevTools protocol, which also keeps the override across navigations. The debugger stays
 * attached for the life of the tab (the page-darkening code shares it and must not detach it).
 */
export function applyChromeIdentity(wc: WebContents, userAgent: string): void {
  const metadata = chromeMetadata(userAgent, process.platform, release(), process.arch)
  if (!metadata) return
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    void wc.debugger
      .sendCommand('Emulation.setUserAgentOverride', { userAgent, userAgentMetadata: metadata })
      .catch(() => {})
    void wc.debugger
      .sendCommand('Page.enable')
      .then(() =>
        wc.debugger
          .sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: CHROME_OBJECT_SCRIPT })
          .catch(() => {})
      )
  } catch {
    // another client holds the debugger (DevTools in an old build): the plain user agent still applies
  }
}
