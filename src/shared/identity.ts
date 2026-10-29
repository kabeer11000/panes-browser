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
  arch: string
): UaMetadata | null {
  const full = chromeVersion(userAgent)
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

/**
 * Runs before a page's own scripts. A normal Chrome page has `window.chrome` with these three members;
 * Chromium embedded in an app has an empty object, another small tell. Only fills what is missing.
 */
export const CHROME_OBJECT_SCRIPT = `(() => {
  const c = (window.chrome = window.chrome || {})
  if (!c.app) c.app = { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } }
  if (!c.csi) c.csi = () => ({ onloadT: Date.now(), startE: performance.timeOrigin, pageT: performance.now(), tran: 15 })
  if (!c.loadTimes) c.loadTimes = () => ({ commitLoadTime: performance.timeOrigin / 1000, connectionInfo: 'h2', navigationType: 'Other', npnNegotiatedProtocol: 'h2', requestTime: performance.timeOrigin / 1000, startLoadTime: performance.timeOrigin / 1000, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true })
})()`
