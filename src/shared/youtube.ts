import type { Settings } from './types'

/**
 * YouTube: the ad defences that run inside its pages, and the optional changes to how it looks and plays.
 *
 * The network side lives with the ad blocker (src/main/adblock.ts). What is here runs in the page itself,
 * from a preload (src/preload/youtube.ts) at document start, before any of YouTube's own scripts: it is the
 * only way to take the ads out of the player's data before the player reads it.
 *
 * Everything in this file is pure so it can be tested; the page script is built from the very functions the
 * tests call (with toString), so what is tested and what runs cannot drift apart.
 */

/** Where the preload runs (Chromium match patterns; `*.` also matches the bare domain). */
export const YOUTUBE_MATCHES = ['https://*.youtube.com/*', 'https://*.youtube-nocookie.com/*']

const YOUTUBE_DOMAINS = ['youtube.com', 'youtube-nocookie.com']

/** youtube.com, www/m/music.youtube.com and the no-cookie embed domain. */
export function isYouTubeHost(host: string): boolean {
  const h = host.toLowerCase()
  return YOUTUBE_DOMAINS.some((d) => h === d || h.endsWith('.' + d))
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && isYouTubeHost(u.hostname)
  } catch {
    return false
  }
}

/** Hosts that only ever serve ads or ad measurement, which YouTube's player and pages call. */
const AD_HOSTS = ['doubleclick.net', 'googleadservices.com', 'googlesyndication.com']

/** Ad endpoints on YouTube's own hosts (from uBlock Origin's and EasyList's YouTube rules). */
const YOUTUBE_AD_PATH =
  /^\/(?:api\/stats\/ads|pagead\/|ptracking|get_midroll_info|pcs\/activeview|youtubei\/v1\/player\/ad_break)/

/**
 * Requests the blocker stops whatever the lists say: a safety net so YouTube's ad calls are blocked even
 * before the lists have loaded (first run, or a failed download). Video itself (googlevideo.com) is never
 * touched here, since one wrong guess there breaks playback; ads are kept out of the player's data instead.
 */
export function isYouTubeAdRequest(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const host = u.hostname.toLowerCase()
  if (AD_HOSTS.some((d) => host === d || host.endsWith('.' + d))) return true
  if (!isYouTubeHost(host)) return false
  if (YOUTUBE_AD_PATH.test(u.pathname)) return true
  return u.pathname === '/get_video_info' && u.search.includes('adunit')
}

// ---- options ----

export const YOUTUBE_SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const
/** YouTube's own quality names, best first; `max` is whatever is best for the video, `auto` leaves it to YouTube. */
export const YOUTUBE_QUALITIES = [
  'auto',
  'max',
  'hd2160',
  'hd1440',
  'hd1080',
  'hd720',
  'large',
  'medium'
] as const
export type YouTubeQuality = (typeof YOUTUBE_QUALITIES)[number]
/** `h264` avoids VP9 and AV1 (least CPU, but at most 1080p); `no-av1` avoids only AV1. */
export const YOUTUBE_CODECS = ['auto', 'no-av1', 'h264'] as const
export type YouTubeCodec = (typeof YOUTUBE_CODECS)[number]

export type YouTubeSettings = Pick<
  Settings,
  | 'youtubeHideShorts'
  | 'youtubeHideEndCards'
  | 'youtubeHideComments'
  | 'youtubeSpeed'
  | 'youtubeQuality'
  | 'youtubeCodec'
  | 'youtubeTheater'
  | 'youtubeAutoplay'
>

/** Everything off: YouTube as it comes, apart from the ads. */
export const YOUTUBE_DEFAULTS: YouTubeSettings = {
  youtubeHideShorts: false,
  youtubeHideEndCards: false,
  youtubeHideComments: false,
  youtubeSpeed: 1,
  youtubeQuality: 'auto',
  youtubeCodec: 'auto',
  youtubeTheater: false,
  youtubeAutoplay: true
}

const BOOLEAN_KEYS = [
  'youtubeHideShorts',
  'youtubeHideEndCards',
  'youtubeHideComments',
  'youtubeTheater',
  'youtubeAutoplay'
] as const

/** The valid YouTube fields of an untrusted settings patch; anything else is dropped. */
export function sanitizeYouTube(patch: Partial<Settings>): Partial<YouTubeSettings> {
  const out: Partial<YouTubeSettings> = {}
  for (const key of BOOLEAN_KEYS) if (typeof patch[key] === 'boolean') out[key] = patch[key]
  if ((YOUTUBE_SPEEDS as readonly unknown[]).includes(patch.youtubeSpeed)) {
    out.youtubeSpeed = patch.youtubeSpeed
  }
  if ((YOUTUBE_QUALITIES as readonly unknown[]).includes(patch.youtubeQuality)) {
    out.youtubeQuality = patch.youtubeQuality
  }
  if ((YOUTUBE_CODECS as readonly unknown[]).includes(patch.youtubeCodec)) {
    out.youtubeCodec = patch.youtubeCodec
  }
  return out
}

// ---- what one page is told ----

/** What a YouTube frame should do; sent at document start and again whenever a setting changes. */
export interface YouTubeConfig {
  /** Take ads out of the player's data and skip any that still start (the blocker is on for this page). */
  ads: boolean
  /** Hide ad slots, banners and upsells (off when the site is set to keep its own elements). */
  cosmetic: boolean
  hideShorts: boolean
  hideEndCards: boolean
  hideComments: boolean
  speed: number
  quality: YouTubeQuality
  codec: YouTubeCodec
  theater: boolean
  autoplay: boolean
}

/** What a page is told when the blocker and every option are off (also how a live page is switched off). */
export const YOUTUBE_OFF: YouTubeConfig = {
  ads: false,
  cosmetic: false,
  hideShorts: false,
  hideEndCards: false,
  hideComments: false,
  speed: 1,
  quality: 'auto',
  codec: 'auto',
  theater: false,
  autoplay: true
}

/**
 * The page's config from the settings and the blocker's verdict for the page's site (its per-site exceptions
 * included). Null when there is nothing to do, so the page is left entirely alone.
 */
export function youtubeConfig(
  s: Settings,
  site: { blocking: boolean; cosmetic: boolean }
): YouTubeConfig | null {
  const cfg: YouTubeConfig = {
    ads: site.blocking,
    cosmetic: site.blocking && site.cosmetic,
    hideShorts: s.youtubeHideShorts,
    hideEndCards: s.youtubeHideEndCards,
    hideComments: s.youtubeHideComments,
    speed: s.youtubeSpeed,
    quality: s.youtubeQuality,
    codec: s.youtubeCodec,
    theater: s.youtubeTheater,
    autoplay: s.youtubeAutoplay
  }
  const same = (Object.keys(cfg) as Array<keyof YouTubeConfig>).every(
    (k) => cfg[k] === YOUTUBE_OFF[k]
  )
  return same ? null : cfg
}

/** What the preload asks main for when a YouTube frame starts. */
export interface YouTubeStart {
  cfg: YouTubeConfig
  /** The filter lists' own scriptlets for the frame (uBlock Origin's YouTube fixes), run at document start. */
  scriptlets: string[]
}

// ---- styles ----

/** Every ad surface: masthead, feed and search slots, companions, overlays, upsells and the enforcement dialog. */
const AD_CSS = [
  '#masthead-ad',
  '#player-ads',
  '#feed-pyv-container',
  'ytd-ad-slot-renderer',
  'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
  'ytd-in-feed-ad-layout-renderer',
  'ytd-banner-promo-renderer',
  'ytd-statement-banner-renderer',
  'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-promoted-sparkles-text-search-renderer',
  'ytd-promoted-video-renderer',
  'ytd-compact-promoted-video-renderer',
  'ytd-display-ad-renderer',
  'ytd-search-pyv-renderer',
  'ytd-companion-slot-renderer',
  'ytd-action-companion-ad-renderer',
  'ytd-player-legacy-desktop-watch-ads-renderer',
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
  'ytd-merch-shelf-renderer',
  'ytd-movie-offer-module-renderer',
  'ytd-primetime-promo-renderer',
  'ytd-brand-video-singleton-renderer',
  'ytd-brand-video-shelf-renderer',
  'ytd-mealbar-promo-renderer',
  'yt-mealbar-promo-renderer',
  'ytmusic-mealbar-promo-renderer',
  'ytmusic-statement-banner-renderer',
  'ytm-promoted-sparkles-web-renderer',
  'ytm-companion-ad-renderer',
  'ad-slot-renderer',
  'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)',
  'ytd-enforcement-message-view-model',
  '.ytp-ad-overlay-container',
  '.ytp-ad-overlay-slot',
  '.ytp-ad-image-overlay',
  '.ytp-suggested-action',
  '.ytp-featured-product',
  // an ad that still starts is muted and run at 16x; there is no need to watch it go by
  '.html5-video-player.ad-showing video'
]

/** Shelves, the side menu and channel tab entries, search results and phone layouts. */
const SHORTS_CSS = [
  'ytd-reel-shelf-renderer',
  'ytd-rich-shelf-renderer[is-shorts]',
  'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
  'grid-shelf-view-model:has(ytm-shorts-lockup-view-model)',
  'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
  'ytd-video-renderer:has(a[href^="/shorts/"])',
  'ytd-guide-entry-renderer:has(a[title="Shorts"])',
  'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
  'yt-tab-shape[tab-title="Shorts"]',
  'ytm-reel-shelf-renderer',
  'ytm-pivot-bar-item-renderer:has(.pivot-shorts)'
]

const END_CARDS_CSS = [
  '.ytp-ce-element',
  '.ytp-cards-teaser',
  '.ytp-cards-button',
  '.ytp-endscreen-content',
  '.iv-branding',
  '.annotation'
]

const COMMENTS_CSS = ['ytd-comments#comments', 'ytm-comment-section-renderer']

/** The style sheet for a config (empty when nothing is hidden); every rule is `!important` so it wins. */
export function youtubeCss(cfg: YouTubeConfig): string {
  const hide = [
    ...(cfg.cosmetic ? AD_CSS : []),
    ...(cfg.hideShorts ? SHORTS_CSS : []),
    ...(cfg.hideEndCards ? END_CARDS_CSS : []),
    ...(cfg.hideComments ? COMMENTS_CSS : [])
  ]
  return hide.length ? `${hide.join(',\n')} { display: none !important; }` : ''
}

// ---- functions that run in the page (self-contained: no references outside their own bodies) ----

/**
 * Removes the ad schedule from player data, in place, and returns how many entries it removed.
 *
 * The data arrives as `ytInitialPlayerResponse` (first load), as the JSON of /youtubei/v1/player and
 * /get_watch (later videos), or wrapped in arrays and objects under `playerResponse`. Without
 * `adPlacements`, `adSlots` and `playerAds` the player has no ads to play. The anti-adblock dialog rides
 * along in `auxiliaryUi.messageRenderers.enforcementMessageViewModel`.
 *
 * The walk is shallow on purpose (a few levels, restarting at each `playerResponse`): YouTube parses large
 * JSON documents all the time and a full walk of each one would cost real CPU.
 */
export function pruneAds(root: unknown): number {
  const KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams']
  const MAX_DEPTH = 2
  const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)
  let removed = 0
  const walk = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      if (depth < MAX_DEPTH) for (const item of node) walk(item, depth + 1)
      return
    }
    const obj = node as Record<string, unknown>
    for (const k of KEYS) {
      if (own(obj, k)) {
        delete obj[k]
        removed++
      }
    }
    const aux = obj.auxiliaryUi as { messageRenderers?: Record<string, unknown> } | undefined
    const renderers = aux && typeof aux === 'object' ? aux.messageRenderers : undefined
    if (
      renderers &&
      typeof renderers === 'object' &&
      own(renderers, 'enforcementMessageViewModel')
    ) {
      delete renderers.enforcementMessageViewModel
      removed++
    }
    for (const k of Object.keys(obj)) {
      if (k === 'playerResponse') walk(obj[k], 0)
      else if (depth < MAX_DEPTH) walk(obj[k], depth + 1)
    }
  }
  walk(root, 0)
  return removed
}

/**
 * The quality to ask the player for: the preferred one if the video has it, else the best below it, else the
 * lowest it has. Null for `auto`, or while the player has not yet said what it has.
 */
export function pickQuality(available: readonly string[], preferred: string): string | null {
  // YouTube's names, best first (it can also report `auto`, which is not a level)
  const ORDER = [
    'highres',
    'hd2880',
    'hd2160',
    'hd1440',
    'hd1080',
    'hd720',
    'large',
    'medium',
    'small',
    'tiny'
  ]
  const rank = (q: string): number => ORDER.indexOf(q)
  const levels = available.filter((q) => rank(q) >= 0).sort((a, b) => rank(a) - rank(b))
  if (preferred === 'auto' || levels.length === 0) return null
  if (preferred === 'max' || rank(preferred) < 0) return levels[0]
  return levels.find((q) => rank(q) >= rank(preferred)) ?? levels[levels.length - 1]
}

/** Whether a media type may be offered to YouTube under a codec preference. */
export function codecAllowed(type: string, codec: string): boolean {
  if (codec === 'auto') return true
  const t = type.toLowerCase()
  if (/av01|av1/.test(t)) return false
  return !(codec === 'h264' && /vp0?9|vp8/.test(t))
}

/** The parts of YouTube's player element the page script uses (all optional: they come and go). */
interface YtPlayer extends HTMLElement {
  getVideoData?: () => { video_id?: string } | undefined
  getPlaybackRate?: () => number
  setPlaybackRate?: (rate: number) => void
  getAvailableQualityLevels?: () => string[]
  setPlaybackQualityRange?: (min: string, max: string) => void
  setPlaybackQuality?: (q: string) => void
  getPlayerState?: () => number
  playVideo?: () => void
}

/**
 * The page script: runs once per frame, in YouTube's own JavaScript world, before YouTube's scripts.
 *
 * Patches are Proxies around the originals, so they still look native to a page that inspects them, and each
 * consults `cfg` at call time: a setting changed later (or the blocker switched off for the site) takes effect
 * without a reload. Patches that can only be decided before YouTube starts (codec, theater) wait for one.
 *
 * Nothing polls. The ad fallback listens for media events (captured at the document, so they cost nothing
 * until a video plays) and watches the player's class attribute only; the dialog watcher looks at the popup
 * container only, and both elements live for the whole page, so the observers end with it.
 */
export function pageMain(
  prune: (root: unknown) => number,
  pick: (available: readonly string[], preferred: string) => string | null,
  allowed: (type: string, codec: string) => boolean,
  cfg: YouTubeConfig,
  channel: string
): void {
  // Live updates from the preload (see youtubeUpdate).
  document.addEventListener(channel, (e) => {
    try {
      Object.assign(cfg, JSON.parse(String((e as CustomEvent).detail)))
    } catch {
      // a malformed update leaves the config as it was
    }
  })

  // ---- ads out of the player's data ----
  const clean = <T>(value: T): T => {
    if (cfg.ads && value !== null && typeof value === 'object') prune(value)
    return value
  }
  JSON.parse = new Proxy(JSON.parse, {
    apply: (target, self, args) => clean(Reflect.apply(target, self, args))
  })
  if (typeof Response !== 'undefined') {
    const proto = Response.prototype
    proto.json = new Proxy(proto.json, {
      apply: (target, self, args) =>
        (Reflect.apply(target, self, args) as Promise<unknown>).then(clean)
    })
  }
  // The first video's data is an inline `var ytInitialPlayerResponse = {...}`, not JSON: catch the assignment.
  let initial: unknown
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: () => initial,
      set: (v) => {
        initial = clean(v)
      }
    })
  } catch {
    // already defined (by a list scriptlet): it guards the same thing
  }

  // ---- codec preference (decided before the player probes the browser) ----
  if (cfg.codec !== 'auto') {
    const codec = cfg.codec
    const ok = (type: unknown): boolean => allowed(String(type ?? ''), codec)
    const ms = window.MediaSource
    if (ms) {
      ms.isTypeSupported = new Proxy(ms.isTypeSupported, {
        apply: (target, self, args) => ok(args[0]) && Reflect.apply(target, self, args)
      })
    }
    const media = HTMLMediaElement.prototype
    media.canPlayType = new Proxy(media.canPlayType, {
      apply: (target, self, args) => (ok(args[0]) ? Reflect.apply(target, self, args) : '')
    })
    const caps = navigator.mediaCapabilities
    if (caps) {
      caps.decodingInfo = new Proxy(caps.decodingInfo, {
        apply: (target, self, args) =>
          ok(args[0]?.video?.contentType)
            ? Reflect.apply(target, self, args)
            : Promise.resolve({ supported: false, smooth: false, powerEfficient: false })
      })
    }
  }

  // ---- theater by default: YouTube reads its `wide` cookie when it builds the watch page ----
  if (cfg.theater && /(^|\.)youtube\.com$/.test(location.hostname)) {
    if (!/(?:^|;\s*)wide=1(?:;|$)/.test(document.cookie)) {
      document.cookie = 'wide=1; domain=.youtube.com; path=/; max-age=31536000; secure'
    }
  }

  // ---- fallback: an ad that starts anyway is muted, run at 16x and skipped where YouTube allows ----
  const AD_RATE = 16
  const SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern'
  let inAd = false
  let mutedByUs = false
  const onAdState = (player: YtPlayer): void => {
    const video = player.querySelector('video')
    if (!video) return
    if (cfg.ads && player.classList.contains('ad-showing')) {
      inAd = true
      if (!video.muted) {
        video.muted = true
        mutedByUs = true
      }
      if (video.playbackRate !== AD_RATE) video.playbackRate = AD_RATE
      player.querySelector<HTMLElement>(SKIP)?.click()
    } else if (inAd) {
      inAd = false
      if (mutedByUs) video.muted = false
      mutedByUs = false
      // back to the rate the player itself thinks it is at (ours was only ever set on the element)
      video.playbackRate = player.getPlaybackRate?.() ?? 1
    }
  }

  // ---- preferences, applied once per video so a change made while watching is kept ----
  let appliedTo = ''
  const applyPrefs = (player: YtPlayer): void => {
    if (!cfg.autoplay) {
      // The toggle is YouTube's own, which it remembers; switching it off once is enough.
      document
        .querySelector<HTMLElement>('.ytp-autonav-toggle-button[aria-checked="true"]')
        ?.click()
    }
    const id = player.getVideoData?.()?.video_id
    if (!id || id === appliedTo) return
    if (cfg.quality !== 'auto') {
      const q = pick(player.getAvailableQualityLevels?.() ?? [], cfg.quality)
      if (!q) return // the levels are not known yet; the next media event tries again
      player.setPlaybackQualityRange?.(q, q)
      player.setPlaybackQuality?.(q)
    }
    if (cfg.speed !== 1) player.setPlaybackRate?.(cfg.speed)
    appliedTo = id
  }

  const watched = new WeakSet<Element>()
  const onMedia = (e: Event): void => {
    const video = e.target
    if (!(video instanceof HTMLVideoElement)) return
    const player = video.closest<YtPlayer>('.html5-video-player')
    if (!player) return
    if (!watched.has(player)) {
      watched.add(player)
      new MutationObserver(() => onAdState(player)).observe(player, {
        attributes: true,
        attributeFilter: ['class']
      })
    }
    onAdState(player)
    if (e.type !== 'ratechange' && !player.classList.contains('ad-showing')) applyPrefs(player)
  }
  // Media events do not bubble, but a capturing listener on the document still sees them.
  for (const type of ['loadedmetadata', 'playing', 'ratechange']) {
    document.addEventListener(type, onMedia, true)
  }

  // ---- the "ad blockers are not allowed" dialog, if one still gets through ----
  let dialogTimer = 0
  const dismiss = (): void => {
    dialogTimer = 0
    if (!cfg.ads) return
    const dialog = document
      .querySelector('ytd-enforcement-message-view-model')
      ?.closest('tp-yt-paper-dialog')
    if (!dialog) return
    dialog.remove()
    document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => b.remove())
    const player = document.getElementById('movie_player') as YtPlayer | null
    if (player?.getPlayerState?.() === 2) player.playVideo?.() // 2: paused by the dialog
  }
  let popups: Element | null = null
  const watchPopups = (): void => {
    const host = document.querySelector('ytd-popup-container')
    if (!host || host === popups) return
    popups = host
    new MutationObserver(() => {
      // batched: YouTube adds a dialog in several steps
      dialogTimer ||= window.setTimeout(dismiss, 50)
    }).observe(host, { childList: true, subtree: true })
  }
  // YouTube is a single page app: it fires this after the first load and after every navigation.
  document.addEventListener('yt-navigate-finish', () => {
    watchPopups()
    dismiss()
  })
  document.addEventListener('DOMContentLoaded', watchPopups)
}

/** The page script for one frame, with the pure helpers above embedded from their own source. */
export function youtubeScript(cfg: YouTubeConfig, channel: string): string {
  const args = [pruneAds, pickQuality, codecAllowed].map(String).join(',\n')
  return `(${String(pageMain)})(\n${args},\n${JSON.stringify(cfg)},\n${JSON.stringify(channel)}\n)`
}

/** Hands a new config to the page script of a frame (run in the page's world, where it listens). */
export function youtubeUpdate(cfg: YouTubeConfig, channel: string): string {
  const detail = JSON.stringify(JSON.stringify(cfg))
  return `document.dispatchEvent(new CustomEvent(${JSON.stringify(channel)}, { detail: ${detail} }))`
}
