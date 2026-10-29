import { release } from 'os'
import type { Session, WebContents } from 'electron'
import {
  CHROME_OBJECT_SCRIPT,
  chromeMetadata,
  wantsChromeIdentity,
  type Brand,
  type UaMetadata
} from '../shared/identity'

const header = (list: Brand[]): string =>
  list.map((b) => `"${b.brand}";v="${b.version}"`).join(', ')

const metadataFor = (chromeUa: string): UaMetadata | null =>
  chromeMetadata(chromeUa, process.platform, release(), process.arch, process.versions.chrome)

/**
 * Two identities. By default Panes is what it is, Chromium with an Electron token: Cloudflare's bot checks
 * pass it, and fail anything that claims to be Chrome without being it. A few sites (Google's sign-in)
 * refuse anything but Chrome, so those, and only those, get a full Chrome identity.
 *
 * In request headers, for every request of a session: the first request of a popup or a new tab goes out
 * before any per-tab override can apply, and it is the one that decides a sign-in. The page a request
 * belongs to decides which identity it carries (a main-frame request is its own page).
 */
export function rewriteClientHints(session: Session, chromeUa: string): void {
  const m = metadataFor(chromeUa)
  if (!m) return
  session.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const page =
      details.resourceType === 'mainFrame'
        ? details.url
        : (details.webContents && !details.webContents.isDestroyed()
            ? details.webContents.getURL()
            : '') || details.url
    if (!wantsChromeIdentity(page)) return callback({ requestHeaders: details.requestHeaders })
    const headers = details.requestHeaders
    for (const name of Object.keys(headers)) {
      const key = name.toLowerCase()
      if (key === 'user-agent') headers[name] = chromeUa
      else if (key === 'sec-ch-ua') headers[name] = header(m.brands)
      else if (key === 'sec-ch-ua-full-version-list') headers[name] = header(m.fullVersionList)
    }
    callback({ requestHeaders: headers })
  })
}

interface Identities {
  /** What the session says by default. */
  plain: string
  /** The Chrome user agent for sites that insist on Chrome. */
  chrome: string
}

const current = new WeakMap<WebContents, boolean>()

/**
 * Point a tab at the identity its page wants: Chrome for the few sites that insist, the plain one for the rest.
 * Uses the DevTools protocol, which keeps the override across navigations. The debugger stays attached for the
 * life of the tab (the page-darkening code shares it and must not detach it).
 */
async function setIdentity(wc: WebContents, ids: Identities, chrome: boolean): Promise<void> {
  if (current.get(wc) === chrome) return
  current.set(wc, chrome)
  const metadata = chrome ? metadataFor(ids.chrome) : undefined
  await wc.debugger
    .sendCommand('Emulation.setUserAgentOverride', {
      userAgent: chrome ? ids.chrome : ids.plain,
      acceptLanguage: 'en-US,en',
      ...(metadata ? { userAgentMetadata: metadata } : {})
    })
    .catch(() => undefined)
}

/**
 * Get a tab ready for its first page: the debugger, the scripts that make a Chrome-identity page look right,
 * and the identity its first address wants. The caller waits for this before it loads anything, so the first
 * page never sees one browser in its user agent and another in its client hints. After that, the tab
 * follows its navigations (see `followIdentity`).
 */
export async function applyIdentity(
  wc: WebContents,
  ids: Identities,
  firstUrl: string
): Promise<void> {
  try {
    // Commands to a page that has never loaded anything wait for a renderer that does not exist yet.
    if (!wc.getURL()) await wc.loadURL('about:blank').catch(() => undefined)
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    await setIdentity(wc, ids, wantsChromeIdentity(firstUrl))
    await wc.debugger.sendCommand('Page.enable').catch(() => undefined)
    await wc.debugger
      .sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: CHROME_OBJECT_SCRIPT })
      .catch(() => undefined)
  } catch {
    // another client holds the debugger (DevTools in an old build): the session's own identity still applies
  }
}

/** Keep a tab's identity matching the page it is going to. Call on each navigation of its main frame. */
export function followIdentity(wc: WebContents, ids: Identities, url: string): void {
  if (!wc.debugger.isAttached()) return
  void setIdentity(wc, ids, wantsChromeIdentity(url))
}
