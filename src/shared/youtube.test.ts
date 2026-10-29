import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS } from './settings'
import type { Settings } from './types'
import {
  YOUTUBE_OFF,
  codecAllowed,
  isYouTubeAdRequest,
  isYouTubeHost,
  isYouTubeUrl,
  pickQuality,
  pruneAds,
  sanitizeYouTube,
  youtubeConfig,
  youtubeCss,
  youtubeScript,
  youtubeUpdate,
  type YouTubeConfig
} from './youtube'

const ON = { blocking: true, cosmetic: true }
const cfgOf = (over: Partial<YouTubeConfig> = {}): YouTubeConfig => ({
  ...YOUTUBE_OFF,
  ads: true,
  cosmetic: true,
  ...over
})

describe('YouTube hosts', () => {
  test('matches YouTube and its subdomains and the embed domain', () => {
    for (const h of [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'www.youtube-nocookie.com',
      'WWW.YouTube.com'
    ]) {
      expect(isYouTubeHost(h)).toBe(true)
    }
  })

  test('does not match look-alikes', () => {
    for (const h of ['notyoutube.com', 'youtube.com.evil.net', 'youtu.be', 'googlevideo.com']) {
      expect(isYouTubeHost(h)).toBe(false)
    }
  })

  test('only https pages count', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=x')).toBe(true)
    expect(isYouTubeUrl('http://www.youtube.com/')).toBe(false)
    expect(isYouTubeUrl('not a url')).toBe(false)
  })
})

describe('isYouTubeAdRequest', () => {
  test('blocks the ad endpoints', () => {
    for (const url of [
      'https://www.youtube.com/api/stats/ads?ver=2&ns=1',
      'https://www.youtube.com/pagead/adview?ai=1',
      'https://www.youtube.com/pagead/interaction/?x',
      'https://www.youtube.com/ptracking?html5=1&video_id=a',
      'https://www.youtube.com/get_midroll_info?ei=1',
      'https://www.youtube.com/pcs/activeview?xai=1',
      'https://www.youtube.com/youtubei/v1/player/ad_break?key=1',
      'https://www.youtube.com/get_video_info?video_id=a&adunit=1',
      'https://music.youtube.com/api/stats/ads?x',
      'https://googleads.g.doubleclick.net/pagead/id',
      'https://static.doubleclick.net/instream/ad_status.js',
      'https://www.googleadservices.com/pagead/conversion/1',
      'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'
    ]) {
      expect(isYouTubeAdRequest(url)).toBe(true)
    }
  })

  test('leaves video, the player, pages and other sites alone', () => {
    for (const url of [
      'https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1&itag=22',
      'https://www.youtube.com/youtubei/v1/player?key=1',
      'https://www.youtube.com/youtubei/v1/next?key=1',
      'https://www.youtube.com/watch?v=pagead',
      'https://www.youtube.com/api/stats/qoe?x',
      'https://www.youtube.com/api/stats/watchtime?x',
      'https://www.youtube.com/get_video_info?video_id=a',
      'https://i.ytimg.com/vi/a/hqdefault.jpg',
      'https://example.com/api/stats/ads',
      'https://doubleclick.net.example.com/x',
      'not a url'
    ]) {
      expect(isYouTubeAdRequest(url)).toBe(false)
    }
  })
})

describe('pruneAds', () => {
  test('removes the ad schedule at the top level and keeps the video', () => {
    const data = {
      adPlacements: [1],
      adSlots: [2],
      playerAds: [3],
      adBreakHeartbeatParams: 'x',
      streamingData: { formats: [1] },
      videoDetails: { videoId: 'a' }
    }
    expect(pruneAds(data)).toBe(4)
    expect(data).toEqual({ streamingData: { formats: [1] }, videoDetails: { videoId: 'a' } })
  })

  test('finds playerResponse inside wrappers and arrays (/watch and /get_watch shapes)', () => {
    const data = [
      { page: 'watch', playerResponse: { adPlacements: [], videoDetails: {} } },
      { response: { contents: {} } }
    ]
    expect(pruneAds(data)).toBe(1)
    expect(data[0].playerResponse).toEqual({ videoDetails: {} })
  })

  test('restarts its depth at every playerResponse, however deep', () => {
    const data = { a: { b: { playerResponse: { playerAds: [] } } } }
    expect(pruneAds(data)).toBe(1)
    expect(data.a.b.playerResponse).toEqual({})
  })

  test('removes the anti-adblock dialog', () => {
    const data = {
      auxiliaryUi: { messageRenderers: { enforcementMessageViewModel: {}, other: 1 } }
    }
    expect(pruneAds(data)).toBe(1)
    expect(data.auxiliaryUi.messageRenderers).toEqual({ other: 1 })
  })

  test('stays shallow: deep look-alikes are not walked', () => {
    const data = { a: { b: { c: { d: { adPlacements: [] } } } } }
    expect(pruneAds(data)).toBe(0)
    expect(data.a.b.c.d).toEqual({ adPlacements: [] })
  })

  test('ignores values that are not objects, and inherited keys', () => {
    for (const v of [null, undefined, 1, 'adPlacements', true]) expect(pruneAds(v)).toBe(0)
    const inherited = Object.create({ adPlacements: [] }) as object
    expect(pruneAds(inherited)).toBe(0)
  })
})

describe('pickQuality', () => {
  const levels = ['hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto']

  test('auto, or no levels yet, asks for nothing', () => {
    expect(pickQuality(levels, 'auto')).toBeNull()
    expect(pickQuality([], 'hd1080')).toBeNull()
    expect(pickQuality(['auto'], 'max')).toBeNull()
  })

  test('max is the best the video has, whatever order the player lists them in', () => {
    expect(pickQuality(['medium', 'hd2160', 'hd720'], 'max')).toBe('hd2160')
  })

  test('the preferred quality, else the best below it, else the lowest there is', () => {
    expect(pickQuality(levels, 'hd720')).toBe('hd720')
    expect(pickQuality(levels, 'hd2160')).toBe('hd1080')
    expect(pickQuality(['hd2160', 'hd1440'], 'hd1080')).toBe('hd1440')
  })

  test('an unknown preference is treated as max', () => {
    expect(pickQuality(levels, 'hd9999')).toBe('hd1080')
  })
})

describe('codecAllowed', () => {
  const av1 = 'video/mp4; codecs="av01.0.08M.08"'
  const vp9 = 'video/webm; codecs="vp9"'
  const vp09 = 'video/webm; codecs="vp09.00.51.08"'
  const h264 = 'video/mp4; codecs="avc1.640028"'
  const opus = 'audio/webm; codecs="opus"'

  test('auto allows everything', () => {
    for (const t of [av1, vp9, h264]) expect(codecAllowed(t, 'auto')).toBe(true)
  })

  test('no-av1 refuses only AV1', () => {
    expect(codecAllowed(av1, 'no-av1')).toBe(false)
    expect(codecAllowed(vp9, 'no-av1')).toBe(true)
    expect(codecAllowed(h264, 'no-av1')).toBe(true)
  })

  test('h264 refuses AV1 and VP9 but keeps audio', () => {
    for (const t of [av1, vp9, vp09]) expect(codecAllowed(t, 'h264')).toBe(false)
    expect(codecAllowed(h264, 'h264')).toBe(true)
    expect(codecAllowed(opus, 'h264')).toBe(true)
  })
})

describe('sanitizeYouTube', () => {
  test('keeps valid values', () => {
    const patch: Partial<Settings> = {
      youtubeHideShorts: true,
      youtubeAutoplay: false,
      youtubeSpeed: 1.5,
      youtubeQuality: 'hd1080',
      youtubeCodec: 'h264'
    }
    expect(sanitizeYouTube(patch)).toEqual(patch)
  })

  test('drops anything else', () => {
    const bad = {
      youtubeHideShorts: 'yes',
      youtubeSpeed: 3,
      youtubeQuality: 'hd9999',
      youtubeCodec: 'vp9',
      searchEngine: 'google'
    } as unknown as Partial<Settings>
    expect(sanitizeYouTube(bad)).toEqual({})
  })
})

describe('youtubeConfig', () => {
  test('nothing to do when the blocker is off and every option is at its default', () => {
    expect(youtubeConfig(DEFAULT_SETTINGS, { blocking: false, cosmetic: true })).toBeNull()
  })

  test('the blocker alone turns the ad defences on', () => {
    expect(youtubeConfig(DEFAULT_SETTINGS, ON)).toEqual(cfgOf())
  })

  test("a site that keeps its own elements keeps the ads' hiding off", () => {
    expect(youtubeConfig(DEFAULT_SETTINGS, { blocking: true, cosmetic: false })?.cosmetic).toBe(
      false
    )
  })

  test('an option alone is enough, without the blocker', () => {
    const s = { ...DEFAULT_SETTINGS, youtubeHideShorts: true }
    const cfg = youtubeConfig(s, { blocking: false, cosmetic: true })
    expect(cfg).toEqual({ ...YOUTUBE_OFF, hideShorts: true })
  })
})

describe('youtubeCss', () => {
  test('empty when nothing is hidden', () => {
    expect(youtubeCss(YOUTUBE_OFF)).toBe('')
    expect(youtubeCss({ ...YOUTUBE_OFF, ads: true })).toBe('')
  })

  test('hides only what is asked for', () => {
    const ads = youtubeCss(cfgOf())
    expect(ads).toContain('ytd-ad-slot-renderer')
    expect(ads).toContain('ytd-enforcement-message-view-model')
    expect(ads).not.toContain('ytd-reel-shelf-renderer')
    const shorts = youtubeCss({ ...YOUTUBE_OFF, hideShorts: true })
    expect(shorts).toContain('ytd-reel-shelf-renderer')
    expect(shorts).not.toContain('ytd-ad-slot-renderer')
    expect(youtubeCss({ ...YOUTUBE_OFF, hideComments: true })).toContain('ytd-comments#comments')
    expect(youtubeCss({ ...YOUTUBE_OFF, hideEndCards: true })).toContain('.ytp-ce-element')
  })

  test('is a single rule that wins over the page', () => {
    const css = youtubeCss(cfgOf({ hideShorts: true, hideEndCards: true, hideComments: true }))
    expect(css.match(/\{/g)).toHaveLength(1)
    expect(css.endsWith('{ display: none !important; }')).toBe(true)
  })
})

/**
 * The page script, run for real against a stand-in page: the same source the preload injects.
 * JSON.parse and Response.prototype.json are the test process's own, so they are put back after each test.
 */
describe('page script', () => {
  const realParse = JSON.parse
  const realJson = Response.prototype.json
  afterEach(() => {
    JSON.parse = realParse
    Response.prototype.json = realJson
  })

  interface Page {
    listeners: Map<string, (e: unknown) => void>
    window: Record<string, unknown>
    document: { cookie: string }
    media: { canPlayType: (type: string) => string }
    dispatch: (code: string) => void
  }
  let page: Page

  const load = (cfg: YouTubeConfig, host = 'www.youtube.com'): void => {
    const listeners = new Map<string, (e: unknown) => void>()
    const document = {
      cookie: '',
      addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
      dispatchEvent: (e: { type: string }) => listeners.get(e.type)?.(e),
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null
    }
    class HTMLMediaElement {
      canPlayType(): string {
        return 'probably'
      }
    }
    const window = { setTimeout }
    const globals = {
      document,
      window,
      location: { hostname: host },
      navigator: {},
      HTMLMediaElement,
      HTMLVideoElement: class {},
      MutationObserver: class {},
      CustomEvent: class {
        constructor(
          public type: string,
          init: { detail: unknown }
        ) {
          Object.assign(this, init)
        }
      }
    }
    const run = (code: string): void =>
      new Function(...Object.keys(globals), code)(...Object.values(globals))
    run(youtubeScript(cfg, 'chan'))
    page = {
      listeners,
      window,
      document,
      media: new HTMLMediaElement(),
      dispatch: (code) => run(code)
    }
  }

  beforeEach(() => load(cfgOf()))

  test('is valid JavaScript that embeds the tested helpers verbatim', () => {
    const script = youtubeScript(cfgOf(), 'chan')
    expect(() => new Function(script)).not.toThrow()
    for (const fn of [pruneAds, pickQuality, codecAllowed]) expect(script).toContain(String(fn))
    expect(script).toContain('"chan"')
  })

  test('takes ads out of JSON the page parses', () => {
    expect(JSON.parse('{"adPlacements":[1],"videoDetails":{}}')).toEqual({ videoDetails: {} })
    expect(JSON.parse('[1,2]')).toEqual([1, 2])
    expect(JSON.parse('"text"')).toBe('text')
  })

  test('takes ads out of fetched JSON', async () => {
    const res = new Response('{"playerResponse":{"adSlots":[],"ok":1}}')
    expect(await res.json()).toEqual({ playerResponse: { ok: 1 } })
  })

  test('takes ads out of the first video, set as a global', () => {
    page.window.ytInitialPlayerResponse = { playerAds: [], videoDetails: {} }
    expect(page.window.ytInitialPlayerResponse).toEqual({ videoDetails: {} })
  })

  test('a live update switches the defences off without a reload', () => {
    page.dispatch(youtubeUpdate({ ...YOUTUBE_OFF }, 'chan'))
    expect(JSON.parse('{"adPlacements":[1]}')).toEqual({ adPlacements: [1] })
    page.dispatch(youtubeUpdate(cfgOf(), 'chan'))
    expect(JSON.parse('{"adPlacements":[1]}')).toEqual({})
  })

  test('an update on another channel is ignored', () => {
    page.dispatch(youtubeUpdate({ ...YOUTUBE_OFF }, 'other'))
    expect(JSON.parse('{"adPlacements":[1]}')).toEqual({})
  })

  test('leaves codecs alone by default, and refuses the avoided ones when asked', () => {
    expect(page.media.canPlayType('video/mp4; codecs="av01.0.08M.08"')).toBe('probably')
    load(cfgOf({ codec: 'h264' }))
    expect(page.media.canPlayType('video/mp4; codecs="av01.0.08M.08"')).toBe('')
    expect(page.media.canPlayType('video/webm; codecs="vp9"')).toBe('')
    expect(page.media.canPlayType('video/mp4; codecs="avc1.640028"')).toBe('probably')
  })

  test('theater mode sets YouTube cookie on youtube.com only', () => {
    expect(page.document.cookie).toBe('')
    load(cfgOf({ theater: true }))
    expect(page.document.cookie).toContain('wide=1')
    load(cfgOf({ theater: true }), 'www.youtube-nocookie.com')
    expect(page.document.cookie).toBe('')
  })

  test('listens for media events and YouTube navigation', () => {
    for (const type of ['loadedmetadata', 'playing', 'ratechange', 'yt-navigate-finish']) {
      expect(page.listeners.has(type)).toBe(true)
    }
  })
})
