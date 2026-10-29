/** The Tor expert bundle Panes fetches on first use: pinned by version and checked against a SHA-256. */
export interface TorBundle {
  version: string
  url: string
  sha256: string
}

const VERSION = '15.0.26'
const BASE = `https://dist.torproject.org/torbrowser/${VERSION}`

/** Only the platforms with a pinned build; others are told Tor is not available yet. */
export function torBundleFor(platform: string, arch: string): TorBundle | null {
  if (platform === 'win32' && arch === 'x64') {
    return {
      version: VERSION,
      url: `${BASE}/tor-expert-bundle-windows-x86_64-${VERSION}.tar.gz`,
      sha256: 'c1988c701de2f24f7d098d1d6d7f507b58f27740d097f29c246e0524d639b252'
    }
  }
  if (platform === 'linux' && arch === 'x64') {
    return {
      version: VERSION,
      url: `${BASE}/tor-expert-bundle-linux-x86_64-${VERSION}.tar.gz`,
      sha256: '19cf18726eecb362e0f21d27afa9ea9efe5da928bfdfbb1ceb5fe54519e87f4a'
    }
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      version: VERSION,
      url: `${BASE}/tor-expert-bundle-macos-aarch64-${VERSION}.tar.gz`,
      sha256: 'a3febb6179152b0b4f56a0f5cc57bf5cc8ecef7db35e7c3e9d5a044c8158c26c'
    }
  }
  if (platform === 'darwin' && arch === 'x64') {
    return {
      version: VERSION,
      url: `${BASE}/tor-expert-bundle-macos-x86_64-${VERSION}.tar.gz`,
      sha256: 'e1ae4d4a734d28bb590839188511deb3cebc26fcbce9df66d01b2c452060fe95'
    }
  }
  return null
}

export interface TorrcOptions {
  socksPort: number
  dataDir: string
  geoip: string
  geoip6: string
  /** Reach Tor through Snowflake bridges (for networks that block it): the client binary and bridge lines. */
  snowflake?: { exec: string; bridges: string[] }
}

/** Forward slashes keep one spelling for torrc paths on every platform; quotes guard spaces in them. */
const path = (p: string): string => `"${p.replaceAll('\\', '/')}"`

export function buildTorrc(o: TorrcOptions): string {
  const lines = [
    `SocksPort 127.0.0.1:${o.socksPort} IsolateSOCKSAuth`,
    'ControlPort 0',
    `DataDirectory ${path(o.dataDir)}`,
    `GeoIPFile ${path(o.geoip)}`,
    `GeoIPv6File ${path(o.geoip6)}`,
    'AvoidDiskWrites 1',
    'ClientOnly 1',
    'SafeLogging 1',
    'Log notice stdout'
  ]
  if (o.snowflake && o.snowflake.bridges.length > 0) {
    lines.push(
      `ClientTransportPlugin snowflake exec ${path(o.snowflake.exec)}`,
      'UseBridges 1',
      ...o.snowflake.bridges.map((b) => `Bridge ${b}`)
    )
  }
  return lines.join('\n') + '\n'
}

/** "Bootstrapped 45% (loading_descriptors): ..." from Tor's log: the percentage, or null for other lines. */
export function parseBootstrap(line: string): number | null {
  const m = /Bootstrapped (\d{1,3})%/.exec(line)
  if (!m) return null
  return Math.min(100, Number(m[1]))
}

/** The Snowflake bridge lines the bundle's own pt_config.json carries (what Tor Browser uses). */
export function snowflakeBridges(ptConfig: unknown): string[] {
  const cfg = ptConfig as { bridges?: { snowflake?: unknown } } | null
  const list = cfg?.bridges?.snowflake
  if (!Array.isArray(list)) return []
  return list
    .filter((b): b is string => typeof b === 'string' && b.startsWith('snowflake '))
    .map((b) => b.trim())
}

export type TorState = 'off' | 'downloading' | 'starting' | 'ready' | 'error'

export interface TorStatus {
  state: TorState
  /** Download or bootstrap progress, 0 to 100. */
  progress: number
  message: string
  /** Whether Snowflake bridges are used. */
  snowflake: boolean
  /** Bytes sent and received through Tor since it started. */
  usage: { up: number; down: number }
  supported: boolean
}
