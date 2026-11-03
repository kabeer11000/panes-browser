import { getDomain, getHostname } from 'tldts'

/**
 * What the ad blocker is built from and how it decides, kept free of Electron so it can be tested.
 *
 * Lists come from Brave's own catalog, read at every update, so when Brave adds, moves or retires a list Panes
 * follows without a release. Scriptlets and redirect files come from a file our GitHub Action rebuilds every
 * day from uBlock Origin's latest release (.github/workflows/adblock-resources.yml), with the copy bundled at
 * release as the fallback. Both keep the blocker current even when Panes itself is not.
 */

export const CATALOG_URL =
  'https://raw.githubusercontent.com/brave/adblock-resources/master/filter_lists/list_catalog.json'

/** Published by .github/workflows/adblock-resources.yml. */
export const RESOURCES_URL =
  'https://github.com/kabeer11000/panes-browser/releases/download/adblock-resources/resources.json'

/**
 * Brave's default desktop lists by catalog id: its default ad lists (uBlock Origin's and EasyList), its
 * privacy lists, and its first-party list. Cookie notices, app promos and iOS-only lists are left out.
 */
export const LIST_IDS = [
  'default',
  '4D715457-307C-4383-8873-73A2FD263F71',
  'E99CBD02-FFD1-4651-9BDD-6A9ED7B87819'
]

export interface CatalogEntry {
  uuid: string
  title?: string
  /** Set on lists that in Standard mode only apply to other sites' requests, never the page's own. */
  first_party_protections?: boolean
  /** Bit 0: the list may use uBlock Origin's trusted scriptlets. */
  permission_mask?: number
  sources: Array<{ url: string; title?: string }>
}

export interface FilterList {
  url: string
  title: string
  /** Applies to a page's own requests in Standard mode too. */
  firstParty: boolean
  permissions: number
}

/** The lists to fetch, from Brave's catalog. Throws if a wanted entry is missing, so a broken catalog never yields an empty engine. */
export function pickLists(catalog: CatalogEntry[]): FilterList[] {
  const out: FilterList[] = []
  for (const id of LIST_IDS) {
    const entry = catalog.find((e) => e.uuid === id)
    if (!entry) throw new Error(`catalog has no list ${id}`)
    for (const source of entry.sources) {
      if (out.some((l) => l.url === source.url)) continue
      out.push({
        url: source.url,
        title: source.title || entry.title || id,
        firstParty: !entry.first_party_protections,
        permissions: entry.permission_mask ?? 0
      })
    }
  }
  return out
}

/** uBlock Origin's `!#if` tokens as Brave answers them; any other token keeps its lines. */
const IF_CONDITIONS = new Map<string, boolean>([
  ['ext_ublock', true],
  ['ext_devbuild', false],
  ['env_devbuild', false],
  ['env_chromium', true],
  ['env_edge', false],
  ['env_firefox', false],
  ['env_legacy', false],
  ['env_safari', false],
  ['cap_html_filtering', false],
  ['cap_user_stylesheet', true],
  ['false', false],
  ['ext_abp', false],
  ['adguard', false],
  ['adguard_app_android', false],
  ['adguard_app_ios', false],
  ['adguard_app_mac', false],
  ['adguard_app_windows', false],
  ['adguard_ext_android_cb', false],
  ['adguard_ext_chromium', true],
  ['adguard_ext_edge', false],
  ['adguard_ext_firefox', false],
  ['adguard_ext_opera', true],
  ['adguard_ext_safari', false]
])

/**
 * Resolves `!#if` / `!#else` / `!#endif` the way Brave does before handing a list to the engine: lines under a
 * false condition go, lines under an unknown one stay, the directives themselves go. Throws on unbalanced
 * directives, which only a damaged download has.
 */
export function preprocess(text: string): string {
  // true: kept, false: dropped, null: unknown token (kept, and `!#else` keeps the other side too)
  const stack: Array<boolean | null> = []
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const keep = !stack.includes(false)
    const m = /^!#if (!?)(.*)$/.exec(line)
    if (m) {
      const value = IF_CONDITIONS.get(m[2].trim())
      stack.push(!keep ? false : value === undefined ? null : m[1] === '!' ? !value : value)
      continue
    }
    if (line === '!#else') {
      if (!stack.length) throw new Error('!#else without !#if')
      const top = stack.pop()!
      const outer = !stack.includes(false)
      stack.push(top === null ? null : outer ? !top : false)
      continue
    }
    if (line === '!#endif') {
      if (!stack.length) throw new Error('!#endif without !#if')
      stack.pop()
      continue
    }
    if (keep) out.push(raw)
  }
  if (stack.length) throw new Error('!#if without !#endif')
  return out.join('\n')
}

/** Electron's `webRequest` resource types, as the engine names them. */
const REQUEST_TYPES: Record<string, string> = {
  mainFrame: 'document',
  subFrame: 'subdocument',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket'
}

export function requestType(electronType: string): string {
  return REQUEST_TYPES[electronType] ?? 'other'
}

/**
 * Same registrable domain, private registries included as Brave counts them (so two github.io sites are
 * strangers). An IP or a host with no known suffix only matches itself.
 */
export function sameSite(a: string, b: string): boolean {
  const ha = getHostname(a)
  const hb = getHostname(b)
  if (!ha || !hb) return false
  if (ha === hb) return true
  const da = getDomain(ha, { allowPrivateDomains: true })
  return !!da && da === getDomain(hb, { allowPrivateDomains: true })
}

/**
 * The saved ad blocker, one file so it is replaced in one atomic rename: each part as a 4-byte length
 * (little-endian) then its bytes, in order: the `all` engine, the `firstParty` engine, resources.json.
 */
export function packEngines(parts: [ArrayBuffer, ArrayBuffer, string]): Uint8Array {
  const bytes = [
    new Uint8Array(parts[0]),
    new Uint8Array(parts[1]),
    new TextEncoder().encode(parts[2])
  ]
  const out = new Uint8Array(bytes.reduce((n, b) => n + 4 + b.length, 0))
  const view = new DataView(out.buffer)
  let at = 0
  for (const b of bytes) {
    view.setUint32(at, b.length, true)
    out.set(b, at + 4)
    at += 4 + b.length
  }
  return out
}

export function unpackEngines(data: Uint8Array): [ArrayBuffer, ArrayBuffer, string] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const parts: Uint8Array<ArrayBuffer>[] = []
  let at = 0
  for (let i = 0; i < 3; i++) {
    if (at + 4 > data.length) throw new Error('ad blocker file is cut short')
    const len = view.getUint32(at, true)
    if (at + 4 + len > data.length) throw new Error('ad blocker file is cut short')
    // a copy of its own, so each engine gets a whole ArrayBuffer and not a view into the file
    const part = new Uint8Array(len)
    part.set(data.subarray(at + 4, at + 4 + len))
    parts.push(part)
    at += 4 + len
  }
  if (at !== data.length) throw new Error('ad blocker file has trailing bytes')
  return [parts[0].buffer, parts[1].buffer, new TextDecoder().decode(parts[2])]
}

/** What a frame's preload is told at document start (src/preload/adblock.ts). */
export interface CosmeticStart {
  /** The lists' scriptlets for this frame, to run in the page's own world before its scripts. */
  scriptlet: string
  /** This site's own hiding rules. */
  hide: string[]
  /** JSON procedural rules and rules with an action (`:has-text`, `:remove()`, `:style()`...). */
  procedural: string[]
  /** Generic selectors this site turns off, passed back with each generic lookup. */
  exceptions: string[]
  /** Look up generic rules for the classes and ids that appear (off when the site has `$generichide`). */
  generic: boolean
  /** Standard mode: generic hiding spares elements that hold the site's own content. */
  standard: boolean
  /** The page's registrable domain, for telling the site's own resources from others in the page. */
  site: string
}

/** What one engine says about a request (adblock-rs `check(..., debug=true)`). */
export interface EngineResult {
  should_block?: boolean
  important?: boolean
  redirect?: string | null
  rewritten_url?: string | null
}

/** What to do with a request: stop it, or send it elsewhere (a stub for a blocked one, or the URL rewritten). */
export type Verdict =
  | { blocked: true; response: { cancel: true } | { redirectURL: string } }
  | { blocked: false; response: { redirectURL: string } }
  | null

/**
 * Brave's request decision. Other sites' requests answer to every list; the page's own requests only to the
 * first-party list, unless blocking is aggressive. A blocked request with a redirect resource gets that
 * instead of an error (a stub script the page expects to exist), and `$removeparam` rewrites only apply to
 * requests that can be safely re-sent (Brave: GET, HEAD, OPTIONS).
 */
export function decide(
  request: { url: string; method: string; type: string },
  firstParty: boolean,
  aggressive: boolean,
  check: (engine: 'all' | 'firstParty') => EngineResult
): Verdict {
  if (request.type === 'document') return null // a page the user asked for is never stopped here
  const r = check(firstParty && !aggressive ? 'firstParty' : 'all')
  if (r.should_block) {
    return { blocked: true, response: r.redirect ? { redirectURL: r.redirect } : { cancel: true } }
  }
  if (
    r.rewritten_url &&
    r.rewritten_url !== request.url &&
    /^(GET|HEAD|OPTIONS)$/.test(request.method)
  ) {
    return { blocked: false, response: { redirectURL: r.rewritten_url } }
  }
  return null
}

/**
 * Requests a working engine must block and must allow. Deserializing a damaged or foreign file yields an
 * engine that quietly blocks nothing, so every loaded engine is checked against these first.
 * The allowed ones are from Brave's own sanity list.
 */
export const CANARY: Array<{ url: string; source: string; type: string; block: boolean }> = [
  {
    url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
    source: 'https://example.com',
    type: 'script',
    block: true
  },
  {
    url: 'https://www.google-analytics.com/analytics.js',
    source: 'https://example.com',
    type: 'script',
    block: true
  },
  {
    url: 'https://en.wikipedia.org/static/images/icons/wikipedia.png',
    source: 'https://en.wikipedia.org/wiki/Ad_blocking',
    type: 'image',
    block: false
  },
  {
    url: 'https://brave.com/js/navigation.js',
    source: 'https://brave.com',
    type: 'script',
    block: false
  }
]
