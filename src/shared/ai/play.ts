/**
 * "Play X on <site>": from a search to the one page that plays it. Pure, so it is tested; the fetching is main's.
 *
 * YouTube is read straight from its results page (the first video) and, for "<channel>'s latest video", from the
 * channel's upload feed (newest first). Any other site goes through a web search limited to it.
 */

import type { WebResult } from './findOpen'

const ID = String.raw`[\w-]{11}`

/** The first real video in a YouTube results page (ads and shorts use other renderers, so they are skipped). */
export function ytFirstVideo(html: string): string | null {
  const m = new RegExp(String.raw`"videoRenderer":\{"videoId":"(${ID})"`).exec(html)
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : null
}

/** The first channel in a YouTube results page. */
export function ytFirstChannel(html: string): string | null {
  return /"channelRenderer":\{"channelId":"(UC[\w-]{22})"/.exec(html)?.[1] ?? null
}

/** YouTube's results for `q`, channels only. */
export const ytChannelSearch = (q: string): string =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(q).replace(/%20/g, '+')}&sp=EgIQAg%253D%253D`

/** A channel's upload feed (newest first). */
export const ytFeed = (channelId: string): string =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`

/** The newest video in a channel's upload feed. */
export function feedNewest(xml: string): string | null {
  const m = new RegExp(String.raw`<yt:videoId>(${ID})</yt:videoId>`).exec(xml)
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : null
}

/** "<channel>'s latest video", "the newest upload from <channel>": the channel's name, else null. */
export function latestOf(query: string): string | null {
  const q = query.trim()
  const KIND = String.raw`(?:video|vid|upload|episode|stream|short)s?`
  const NEW = String.raw`(?:latest|newest|most\s+recent|last|new|recent)`
  const after = new RegExp(String.raw`^(.+?)(?:'s|’s|')?\s+${NEW}\s+${KIND}$`, 'i').exec(q)
  const before = new RegExp(
    String.raw`^(?:the\s+)?${NEW}\s+${KIND}\s+(?:of|from|by)\s+(.+)$`,
    'i'
  ).exec(q)
  const name = (after?.[1] ?? before?.[1])?.trim()
  return name || null
}

/** Only the results on `domain` (or under it). */
export function onDomain(results: readonly WebResult[], domain: string): WebResult[] {
  return results.filter((r) => {
    try {
      const h = new URL(r.url).hostname.replace(/^www\./, '')
      return h === domain || h.endsWith(`.${domain}`)
    } catch {
      return false
    }
  })
}
