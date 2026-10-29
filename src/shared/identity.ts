/** A brand and its version, as in `navigator.userAgentData.brands`. */
export interface Brand {
  brand: string
  version: string
}

export interface UaMetadata {
  brands: Brand[]
  fullVersionList: Brand[]
  platform: string
  platformVersion: string
  architecture: string
  bitness: string
  model: string
  mobile: boolean
  wow64: boolean
}

/** The version in a user agent's "Chrome/152.0.7977.169" token, or null when it has none. */
export function chromeVersion(userAgent: string): string | null {
  return /\bChrome\/(\d+\.\d+\.\d+\.\d+)\b/.exec(userAgent)?.[1] ?? null
}

/** Windows' own version number as sites see it through client hints, from the build in `os.release()`. */
export function windowsPlatformVersion(osRelease: string): string {
  const build = Number(osRelease.split('.')[2])
  if (build >= 26100) return '19.0.0'
  if (build >= 22631) return '15.0.0'
  if (build >= 22000) return '13.0.0'
  return '10.0.0'
}

const PLATFORM: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }

/**
 * What a real Google Chrome of the same version reports about itself. Chromium alone lists only
 * "Chromium" among its brands, which next to a Chrome user agent is exactly the mismatch some sites
 * (Google's sign-in among them) treat as an unsupported or automated browser.
 */
export function chromeMetadata(
  userAgent: string,
  platform: string,
  osRelease: string,
  arch: string,
  /** The browser's real full version: Chrome's user agent shows only "152.0.0.0", while client hints give all of it. */
  fullVersion?: string
): UaMetadata | null {
  const full = fullVersion ?? chromeVersion(userAgent)
  if (!full) return null
  const major = full.split('.')[0]
  return {
    brands: [
      { brand: 'Chromium', version: major },
      { brand: 'Google Chrome', version: major },
      { brand: 'Not?A_Brand', version: '24' }
    ],
    fullVersionList: [
      { brand: 'Chromium', version: full },
      { brand: 'Google Chrome', version: full },
      { brand: 'Not?A_Brand', version: '24.0.0.0' }
    ],
    platform: PLATFORM[platform] ?? 'Linux',
    platformVersion: platform === 'win32' ? windowsPlatformVersion(osRelease) : '',
    architecture: arch === 'arm64' ? 'arm' : 'x86',
    bitness: '64',
    model: '',
    mobile: false,
    wow64: false
  }
}

const CHROME_ONLY_SUFFIXES = [
  'youtube.com',
  'youtube-nocookie.com',
  'googleusercontent.com',
  'gstatic.com',
  'googleapis.com',
  'ggpht.com'
]

/**
 * Whether a page is on a site that refuses anything but Chrome (Google's sign-in is the one that matters).
 * Everything else sees Panes as what it is: Cloudflare's checks pass that, and fail a pretend Chrome.
 */
export function wantsChromeIdentity(urlOrHost: string): boolean {
  let host = urlOrHost
  try {
    host = new URL(urlOrHost).hostname
  } catch {
    // already a host name
  }
  host = host.toLowerCase()
  if (CHROME_ONLY_SUFFIXES.some((s) => host === s || host.endsWith('.' + s))) return true
  // google.com, google.co.uk, accounts.google.de ...
  return /(^|[.])google[.][a-z]{2,3}([.][a-z]{2})?$/.test(host)
}

/**
 * Runs before a page's own scripts. A normal Chrome page has `window.chrome` with these three members;
 * Chromium embedded in an app has an empty object, another small tell. Only fills what is missing.
 */
export const CHROME_OBJECT_SCRIPT = `(() => {
  // Only the sites that insist on Chrome get the Chrome look: anything else is better off as itself.
  const H = location.hostname
  if (!/(^|[.])((google|youtube)[.]|youtube-nocookie[.]com$|googleusercontent[.]com$|gstatic[.]com$|googleapis[.]com$|ggpht[.]com$)/.test(H)) return
  const c = (window.chrome = window.chrome || {})
  if (!c.app) c.app = { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } }
  if (!c.csi) c.csi = () => ({ onloadT: Date.now(), startE: performance.timeOrigin, pageT: performance.now(), tran: 15 })
  if (!c.loadTimes) c.loadTimes = () => ({ commitLoadTime: performance.timeOrigin / 1000, connectionInfo: 'h2', navigationType: 'Other', npnNegotiatedProtocol: 'h2', requestTime: performance.timeOrigin / 1000, startLoadTime: performance.timeOrigin / 1000, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true })

  // Embedded Chromium answers every permission question with "denied". Chrome says "prompt" until you decide,
  // and a page that sees "denied" everywhere (notifications included) takes it for an automated browser.
  const nativeText = new WeakMap()
  const realToString = Function.prototype.toString
  const toStringProxy = new Proxy(realToString, { apply: (t, self, args) => nativeText.get(self) || Reflect.apply(t, self, args) })
  nativeText.set(toStringProxy, 'function toString() { [native code] }')
  Function.prototype.toString = toStringProxy
  const pretend = (fn, name) => { nativeText.set(fn, 'function ' + name + '() { [native code] }'); return fn }
  const ASKED = new Set(['notifications', 'geolocation', 'camera', 'microphone', 'midi', 'clipboard-read', 'persistent-storage', 'push'])
  try {
    const P = Permissions.prototype
    const realQuery = P.query
    P.query = pretend(async function query(desc) {
      const status = await realQuery.call(this, desc)
      if (status.state !== 'denied' || !desc || !ASKED.has(desc.name)) return status
      return new Proxy(status, { get: (t, k) => (k === 'state' ? 'prompt' : (v => typeof v === 'function' ? v.bind(t) : v)(Reflect.get(t, k))) })
    }, 'query')
    const d = Object.getOwnPropertyDescriptor(Notification, 'permission')
    if (d && d.get) {
      const realGet = d.get
      Object.defineProperty(Notification, 'permission', { ...d, get: pretend(function permission() { const p = realGet.call(this); return p === 'denied' ? 'default' : p }, 'get permission') })
    }
  } catch {}
})()`
