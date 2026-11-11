/**
 * Sites the assistant knows how to search, and the plain commands that need no model at all ("search piano covers on
 * youtube", "play lofi on spotify", "open github"). Pure; no Electron.
 *
 * A small local model is poor at building a search address (encoding, the right path per site), so the address is
 * always made here: by the quick command before any model runs, and by the search_on_site tool the model calls with
 * just a site name and the words.
 */

export interface Site {
  id: string
  /** What the person and the answer call it. */
  name: string
  /** Other names it goes by, lower case. */
  aliases: string[]
  home: string
  /** The site's own search page for the words (encoded here). */
  search: (q: string) => string
}

const enc = encodeURIComponent
const plus = (q: string): string => enc(q).replace(/%20/g, '+')

export const SITES: readonly Site[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    aliases: ['youtube', 'yt', 'you tube', 'youtube.com'],
    home: 'https://www.youtube.com/',
    search: (q) => `https://www.youtube.com/results?search_query=${plus(q)}`
  },
  {
    id: 'youtube-music',
    name: 'YouTube Music',
    aliases: ['youtube music', 'yt music', 'music.youtube.com'],
    home: 'https://music.youtube.com/',
    search: (q) => `https://music.youtube.com/search?q=${plus(q)}`
  },
  {
    id: 'google',
    name: 'Google',
    aliases: ['google', 'google.com'],
    home: 'https://www.google.com/',
    search: (q) => `https://www.google.com/search?q=${plus(q)}`
  },
  {
    id: 'google-images',
    name: 'Google Images',
    aliases: ['google images', 'images'],
    home: 'https://images.google.com/',
    search: (q) => `https://www.google.com/search?tbm=isch&q=${plus(q)}`
  },
  {
    id: 'maps',
    name: 'Google Maps',
    aliases: ['maps', 'google maps', 'map'],
    home: 'https://www.google.com/maps',
    search: (q) => `https://www.google.com/maps/search/${enc(q)}`
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    aliases: ['duckduckgo', 'ddg', 'duck duck go'],
    home: 'https://duckduckgo.com/',
    search: (q) => `https://duckduckgo.com/?q=${plus(q)}`
  },
  {
    id: 'bing',
    name: 'Bing',
    aliases: ['bing'],
    home: 'https://www.bing.com/',
    search: (q) => `https://www.bing.com/search?q=${plus(q)}`
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    aliases: ['wikipedia', 'wiki'],
    home: 'https://en.wikipedia.org/',
    search: (q) => `https://en.wikipedia.org/w/index.php?search=${plus(q)}`
  },
  {
    id: 'reddit',
    name: 'Reddit',
    aliases: ['reddit'],
    home: 'https://www.reddit.com/',
    search: (q) => `https://www.reddit.com/search/?q=${enc(q)}`
  },
  {
    id: 'x',
    name: 'X',
    aliases: ['x', 'twitter', 'x.com', 'twitter.com'],
    home: 'https://x.com/',
    search: (q) => `https://x.com/search?q=${enc(q)}`
  },
  {
    id: 'github',
    name: 'GitHub',
    aliases: ['github', 'gh'],
    home: 'https://github.com/',
    search: (q) => `https://github.com/search?q=${enc(q)}`
  },
  {
    id: 'stackoverflow',
    name: 'Stack Overflow',
    aliases: ['stack overflow', 'stackoverflow', 'so'],
    home: 'https://stackoverflow.com/',
    search: (q) => `https://stackoverflow.com/search?q=${plus(q)}`
  },
  {
    id: 'amazon',
    name: 'Amazon',
    aliases: ['amazon'],
    home: 'https://www.amazon.com/',
    search: (q) => `https://www.amazon.com/s?k=${plus(q)}`
  },
  {
    id: 'ebay',
    name: 'eBay',
    aliases: ['ebay'],
    home: 'https://www.ebay.com/',
    search: (q) => `https://www.ebay.com/sch/i.html?_nkw=${plus(q)}`
  },
  {
    id: 'spotify',
    name: 'Spotify',
    aliases: ['spotify'],
    home: 'https://open.spotify.com/',
    search: (q) => `https://open.spotify.com/search/${enc(q)}`
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    aliases: ['soundcloud'],
    home: 'https://soundcloud.com/',
    search: (q) => `https://soundcloud.com/search?q=${enc(q)}`
  },
  {
    id: 'twitch',
    name: 'Twitch',
    aliases: ['twitch'],
    home: 'https://www.twitch.tv/',
    search: (q) => `https://www.twitch.tv/search?term=${enc(q)}`
  },
  {
    id: 'netflix',
    name: 'Netflix',
    aliases: ['netflix'],
    home: 'https://www.netflix.com/',
    search: (q) => `https://www.netflix.com/search?q=${enc(q)}`
  },
  {
    id: 'imdb',
    name: 'IMDb',
    aliases: ['imdb'],
    home: 'https://www.imdb.com/',
    search: (q) => `https://www.imdb.com/find/?q=${enc(q)}`
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    aliases: ['pinterest'],
    home: 'https://www.pinterest.com/',
    search: (q) => `https://www.pinterest.com/search/pins/?q=${enc(q)}`
  },
  {
    id: 'instagram',
    name: 'Instagram',
    aliases: ['instagram', 'insta', 'ig'],
    home: 'https://www.instagram.com/',
    search: (q) => `https://www.instagram.com/explore/search/keyword/?q=${enc(q)}`
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    aliases: ['tiktok', 'tik tok'],
    home: 'https://www.tiktok.com/',
    search: (q) => `https://www.tiktok.com/search?q=${enc(q)}`
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    aliases: ['linkedin'],
    home: 'https://www.linkedin.com/',
    search: (q) => `https://www.linkedin.com/search/results/all/?keywords=${enc(q)}`
  },
  {
    id: 'npm',
    name: 'npm',
    aliases: ['npm', 'npmjs'],
    home: 'https://www.npmjs.com/',
    search: (q) => `https://www.npmjs.com/search?q=${enc(q)}`
  },
  {
    id: 'mdn',
    name: 'MDN',
    aliases: ['mdn', 'mdn web docs'],
    home: 'https://developer.mozilla.org/',
    search: (q) => `https://developer.mozilla.org/en-US/search?q=${enc(q)}`
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    aliases: ['arxiv'],
    home: 'https://arxiv.org/',
    search: (q) => `https://arxiv.org/search/?query=${plus(q)}&searchtype=all`
  },
  {
    id: 'scholar',
    name: 'Google Scholar',
    aliases: ['google scholar', 'scholar'],
    home: 'https://scholar.google.com/',
    search: (q) => `https://scholar.google.com/scholar?q=${plus(q)}`
  }
]

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/^(?:the\s+)/, '')
    .replace(/[.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()

const BY_ALIAS = new Map<string, Site>()
for (const s of SITES)
  for (const a of [...s.aliases, s.id, s.name.toLowerCase()]) BY_ALIAS.set(a, s)

/** A known site by any of its names ("YouTube", "yt", "youtube.com"), or null. */
export function siteNamed(name: string): Site | null {
  const n = norm(name).replace(/^(?:www\.)/, '')
  return BY_ALIAS.get(n) ?? BY_ALIAS.get(n.replace(/\.(?:com|org|net|tv|io)$/, '')) ?? null
}

/**
 * The address that searches `site` for `query`: the site's own search page when it is a known site, else a web
 * search limited to that domain (`engine` is the search engine's address, the words go on its end).
 */
export function siteSearchUrl(
  site: string,
  query: string,
  engine = 'https://duckduckgo.com/?q='
): { url: string; name: string } {
  const known = siteNamed(site)
  if (known) return { url: known.search(query.trim()), name: known.name }
  const domain = site
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
  const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)
  const words = looksLikeDomain
    ? `site:${domain} ${query.trim()}`
    : `${site.trim()} ${query.trim()}`
  return { url: engine + enc(words), name: looksLikeDomain ? domain : site.trim() }
}

export type QuickAction =
  | { kind: 'search'; site: string; query: string; url: string; say: string }
  | { kind: 'open'; site: string; url: string; say: string }
  /** Play the thing itself: `url` is the site's search page, opened if the thing cannot be found. */
  | {
      kind: 'play'
      site: string
      /** The site's address, for a web search limited to it. */
      domain: string
      youtube: boolean
      query: string
      url: string
      say: string
    }

/** Sites where "play X" means a page that plays it, not a page of results. */
const MEDIA = new Set(['youtube', 'youtube-music', 'spotify', 'soundcloud', 'twitch', 'tiktok'])
const PLAY_WORDS = String.raw`play|watch|listen\s+to|put\s+on|turn\s+on|switch\s+on|start|stream|queue(?:\s+up)?|throw\s+on|fire\s+up`
const PLAY = new RegExp(String.raw`^(?:${PLAY_WORDS})\b`, 'i')

export const POLITE =
  /^(?:(?:hey|hi|ok|okay)[,\s]+)?(?:(?:can|could|would|will)\s+you\s+|please\s+|pls\s+|plz\s+|i\s+want\s+to\s+|i'?d\s+like\s+to\s+|let'?s\s+)*/i
export const TAIL = /[\s.!?]*(?:\s+(?:please|pls|plz|for\s+me|thanks|thank\s+you))*[\s.!?]*$/i
const VERB = String.raw`(?:search(?:\s+for)?|look\s+up|look\s+for|find(?:\s+me)?|show(?:\s+me)?|${PLAY_WORDS}|pull\s+up|bring\s+up|get(?:\s+me)?)`
const OPEN = String.raw`(?:open(?:\s+up)?|go\s+to|goto|launch|take\s+me\s+to|visit|navigate\s+to)`

const clean = (s: string): string =>
  s
    .trim()
    .replace(/^["“'‘]|["”'’]$/g, '')
    .trim()

/**
 * A plain command the browser can carry out directly, before (and without) a model: a search on a known site, or
 * opening one. Questions and anything vaguer return null and go to the model.
 */
export function quickAction(raw: string): QuickAction | null {
  const t = raw.replace(/\s+/g, ' ').trim()
  if (!t || t.length > 200 || t.includes('\n')) return null
  const s = t.replace(POLITE, '').replace(TAIL, '').trim()
  if (!s || /\?$/.test(t)) return null
  const play = PLAY.test(s)
  const search = (siteName: string, q: string): QuickAction | null => {
    const site = siteNamed(siteName)
    const query = clean(q)
    if (!site || !query || query.length > 160) return null
    if (play && MEDIA.has(site.id))
      return {
        kind: 'play',
        site: site.name,
        domain: new URL(site.home).hostname.replace(/^(?:www|open)\./, ''),
        youtube: site.id === 'youtube',
        query,
        url: site.search(query),
        say: `Playing “${query}” on ${site.name}.`
      }
    return {
      kind: 'search',
      site: site.name,
      query,
      url: site.search(query),
      say: `Searching ${site.name} for “${query}”.`
    }
  }
  // "search piano covers on youtube", "play lofi beats on spotify", "find a pasta recipe on youtube"
  let m = new RegExp(String.raw`^${VERB}\s+(.+?)\s+(?:on|in|at|from|over\s+on)\s+(.+)$`, 'i').exec(
    s
  )
  if (m) {
    const hit = search(m[2], m[1])
    if (hit) return hit
  }
  // "open youtube and search for family guy", "go to youtube, search family guy", "open youtube then play lofi"
  m = new RegExp(
    String.raw`^${OPEN}\s+(.+?)\s*(?:,|\band(?:\s+then)?\b|\bthen\b)\s*${VERB}\s+(.+)$`,
    'i'
  ).exec(s)
  if (m) {
    const hit = search(m[1], m[2])
    if (hit) return hit
  }
  // "search youtube for piano covers", "youtube search piano covers", "youtube: piano covers", "yt piano covers"
  m = new RegExp(String.raw`^(?:${VERB}\s+)?(.+?)\s+(?:for|search(?:\s+for)?|:)\s*(.+)$`, 'i').exec(
    s
  )
  if (m && siteNamed(m[1])) {
    const hit = search(m[1], m[2])
    if (hit) return hit
  }
  m = /^([^\s:]+(?:\s+music)?)\s*:?\s+(.+)$/i.exec(s)
  if (m && siteNamed(m[1]) && !new RegExp(`^${OPEN}$`, 'i').test(m[1])) {
    const hit = search(m[1], m[2])
    if (hit) return hit
  }
  // "open youtube", "go to github", "take me to reddit"
  m = new RegExp(String.raw`^${OPEN}\s+(.+)$`, 'i').exec(s)
  if (m) {
    const site = siteNamed(m[1])
    if (site) return { kind: 'open', site: site.name, url: site.home, say: `Opening ${site.name}.` }
  }
  return null
}
