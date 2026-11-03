import type { SearchEngineId } from './types'

/**
 * Importing from other browsers: where each one keeps its profiles, and parsers for the files read from them.
 * Pure, so it is tested; the file reading is in main/importer.ts.
 */

export type BrowserFamily = 'chromium' | 'firefox'

export interface BrowserSource {
  id: string
  name: string
  family: BrowserFamily
  /** The browser's data folder per platform. `%VAR%` is an environment variable, `~` the home folder. */
  roots: Partial<Record<string, string>>
  /** Matches the name the system gives the default web browser (app.getApplicationNameForProtocol). */
  match: RegExp
  /** Where to find the browser's own password export, shown on the password step. */
  passwordExport: string
  /** The data folder is itself the profile (Opera), instead of holding Default, Profile 1... */
  singleProfile?: boolean
}

const chromiumExport = (scheme: string): string =>
  `Open ${scheme}://password-manager/settings and choose Export passwords.`

export const BROWSER_SOURCES: BrowserSource[] = [
  {
    id: 'brave',
    name: 'Brave',
    family: 'chromium',
    roots: {
      win32: '%LOCALAPPDATA%/BraveSoftware/Brave-Browser/User Data',
      darwin: '~/Library/Application Support/BraveSoftware/Brave-Browser',
      linux: '~/.config/BraveSoftware/Brave-Browser'
    },
    match: /brave/i,
    passwordExport: chromiumExport('brave')
  },
  {
    id: 'chrome',
    name: 'Google Chrome',
    family: 'chromium',
    roots: {
      win32: '%LOCALAPPDATA%/Google/Chrome/User Data',
      darwin: '~/Library/Application Support/Google/Chrome',
      linux: '~/.config/google-chrome'
    },
    match: /chrome/i,
    passwordExport: chromiumExport('chrome')
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    family: 'chromium',
    roots: {
      win32: '%LOCALAPPDATA%/Microsoft/Edge/User Data',
      darwin: '~/Library/Application Support/Microsoft Edge',
      linux: '~/.config/microsoft-edge'
    },
    match: /edge/i,
    passwordExport:
      'Open edge://settings/passwords, then the ... menu, and choose Export passwords.'
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    family: 'chromium',
    roots: {
      win32: '%LOCALAPPDATA%/Vivaldi/User Data',
      darwin: '~/Library/Application Support/Vivaldi',
      linux: '~/.config/vivaldi'
    },
    match: /vivaldi/i,
    passwordExport: chromiumExport('vivaldi')
  },
  {
    id: 'opera',
    name: 'Opera',
    family: 'chromium',
    roots: {
      win32: '%APPDATA%/Opera Software/Opera Stable',
      darwin: '~/Library/Application Support/com.operasoftware.Opera',
      linux: '~/.config/opera'
    },
    match: /opera/i,
    passwordExport: chromiumExport('opera'),
    singleProfile: true
  },
  {
    id: 'firefox',
    name: 'Firefox',
    family: 'firefox',
    roots: {
      win32: '%APPDATA%/Mozilla/Firefox',
      darwin: '~/Library/Application Support/Firefox',
      linux: '~/.mozilla/firefox'
    },
    match: /firefox/i,
    passwordExport: 'Open about:logins, then the ... menu, and choose Export passwords.'
  },
  {
    id: 'zen',
    name: 'Zen',
    family: 'firefox',
    roots: {
      win32: '%APPDATA%/zen',
      darwin: '~/Library/Application Support/zen',
      linux: '~/.zen'
    },
    match: /\bzen\b/i,
    passwordExport: 'Open about:logins, then the ... menu, and choose Export passwords.'
  },
  {
    id: 'librewolf',
    name: 'LibreWolf',
    family: 'firefox',
    roots: {
      win32: '%APPDATA%/librewolf',
      darwin: '~/Library/Application Support/librewolf',
      linux: '~/.librewolf'
    },
    match: /librewolf/i,
    passwordExport: 'Open about:logins, then the ... menu, and choose Export passwords.'
  }
]

/** The data folder on this computer, or null when the browser has none here. */
export function sourceRoot(
  source: BrowserSource,
  platform: string,
  env: Record<string, string | undefined>,
  home: string
): string | null {
  const raw = source.roots[platform]
  if (!raw) return null
  let missing = false
  const out = raw
    .replace(/%(\w+)%/g, (_, k: string) => env[k] ?? ((missing = true), ''))
    .replace(/^~(?=\/)/, home)
  return missing ? null : out
}

export interface SourceProfile {
  /** Folder of the profile: relative to the data folder, or absolute (a Firefox profile kept elsewhere). */
  dir: string
  name: string
}

/** Chromium's profiles, from `Local State`. A browser that never wrote one still has Default. */
export function chromiumProfiles(localState: string | null): SourceProfile[] {
  try {
    const cache = (JSON.parse(localState ?? '') as { profile?: { info_cache?: object } }).profile
      ?.info_cache as Record<string, { name?: string }> | undefined
    const list = Object.entries(cache ?? {}).map(([dir, p]) => ({ dir, name: p.name || dir }))
    if (list.length)
      return list.sort((a, b) => (a.dir === 'Default' ? -1 : b.dir === 'Default' ? 1 : 0))
  } catch {
    // damaged or missing: fall through to the one profile every Chromium has
  }
  return [{ dir: 'Default', name: 'Default' }]
}

/** Firefox's profiles, from `profiles.ini`: the one marked as default first. */
export function firefoxProfiles(ini: string): SourceProfile[] {
  const list: Array<SourceProfile & { def: boolean }> = []
  let cur: Record<string, string> | null = null
  const flush = (): void => {
    if (cur?.Path)
      list.push({ dir: cur.Path, name: cur.Name || cur.Path, def: cur.Default === '1' })
  }
  for (const line of ini.split(/\r?\n/)) {
    const head = /^\[(.+)\]$/.exec(line.trim())
    if (head) {
      flush()
      cur = head[1].startsWith('Profile') ? {} : null
      continue
    }
    const eq = line.indexOf('=')
    if (cur && eq > 0) cur[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  flush()
  return list.sort((a, b) => Number(b.def) - Number(a.def)).map(({ dir, name }) => ({ dir, name }))
}

/** Chromium keeps times as microseconds since 1601; this many milliseconds lie between that and 1970. */
export const CHROME_EPOCH_OFFSET_MS = 11_644_473_600_000

/** A Chromium time (microseconds since 1601, often a string) as milliseconds since 1970; 0 when unset. */
export function chromeTimeMs(us: string | number | undefined): number {
  const n = Number(us)
  return n > 0 ? Math.round(n / 1000) - CHROME_EPOCH_OFFSET_MS : 0
}

export interface ImportedPage {
  url: string
  title: string
  time: number
}

const isWeb = (url: string): boolean => /^https?:\/\//i.test(url)

interface ChromiumNode {
  type?: string
  url?: string
  name?: string
  date_added?: string
  children?: ChromiumNode[]
}

/** Every bookmark in Chromium's `Bookmarks` file, folders flattened away (Panes bookmarks have none). */
export function chromiumBookmarks(json: string): ImportedPage[] {
  const out: ImportedPage[] = []
  const walk = (n: ChromiumNode | undefined): void => {
    if (!n) return
    if (n.type === 'url' && n.url && isWeb(n.url)) {
      out.push({ url: n.url, title: n.name || n.url, time: chromeTimeMs(n.date_added) })
    }
    n.children?.forEach(walk)
  }
  const roots = (JSON.parse(json) as { roots?: Record<string, ChromiumNode> }).roots ?? {}
  Object.values(roots).forEach((r) => walk(typeof r === 'object' ? r : undefined))
  return out
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}
const decode = (s: string): string =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(
          e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
        )
      : (ENTITIES[e.toLowerCase()] ?? m)
  )

/** Bookmarks from the HTML file every browser exports (the Netscape bookmark format), folders flattened. */
export function htmlBookmarks(html: string): ImportedPage[] {
  const out: ImportedPage[] = []
  for (const m of html.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attr = (name: string): string | undefined =>
      new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(m[1])?.[1]
    const url = decode(attr('href') ?? '')
    if (!isWeb(url)) continue
    const added = Number(attr('add_date'))
    const title = decode(m[2].replace(/<[^>]+>/g, '')).trim()
    out.push({ url, title: title || url, time: added > 0 ? added * 1000 : 0 })
  }
  return out
}

/** Panes' engine for another browser's default search address, when it is one Panes has. */
export function searchEngineFor(url: string | undefined): SearchEngineId | null {
  let host: string
  try {
    // Chromium writes Google's own address as a placeholder for the country's Google site
    const plain = (url ?? '').replace(/^\{google:baseURL\}/, 'https://www.google.com/')
    host = new URL(plain.replace(/\{[^}]*\}/g, 'x')).hostname
  } catch {
    return null
  }
  if (host === 'search.brave.com') return 'brave'
  if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) return 'duckduckgo'
  if (host === 'bing.com' || host.endsWith('.bing.com')) return 'bing'
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return 'google'
  return null
}

/** Chromium's default search address, from a profile's `Preferences` (newer versions call it mirrored). */
export function chromiumSearchUrl(preferences: string): string | undefined {
  type Data = { url?: string }
  try {
    const d = (
      JSON.parse(preferences) as {
        default_search_provider_data?: {
          mirrored_template_url_data?: Data
          template_url_data?: Data
        }
      }
    ).default_search_provider_data
    return (d?.mirrored_template_url_data ?? d?.template_url_data)?.url
  } catch {
    return undefined
  }
}

/**
 * Imported pages merged into a newest-first list: the same address at the same time is not added twice,
 * pages without a time take `now`, and only the newest `cap` are kept. New entries get ids from `nextId`.
 */
export function mergeByTime<T extends { id: number; url: string; time: number }>(
  existing: T[],
  incoming: ImportedPage[],
  make: (p: ImportedPage, id: number) => T,
  nextId: number,
  cap: number,
  now = Date.now()
): { items: T[]; nextId: number; added: number } {
  const seen = new Set(existing.map((e) => `${e.time} ${e.url}`))
  const fresh: T[] = []
  for (const p of incoming) {
    if (!isWeb(p.url)) continue
    const time = p.time > 0 ? p.time : now
    const key = `${time} ${p.url}`
    if (seen.has(key)) continue
    seen.add(key)
    fresh.push(make({ ...p, time }, nextId++))
  }
  const items = [...existing, ...fresh].sort((a, b) => b.time - a.time).slice(0, cap)
  const kept = new Set(items)
  return { items, nextId, added: fresh.filter((f) => kept.has(f)).length }
}
