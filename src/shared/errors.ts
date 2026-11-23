/** The families of failed page loads Panes has a custom page for. */
export type ErrorKind =
  'offline' | 'dns' | 'refused' | 'timeout' | 'cert' | 'blocked' | 'crashed' | 'generic'

export interface ErrorInfo {
  kind: ErrorKind
  title: string
  message: string
  tips: string[]
}

const KIND_OF: Array<[RegExp, ErrorKind]> = [
  [/INTERNET_DISCONNECTED|NETWORK_CHANGED|NETWORK_ACCESS_DENIED/, 'offline'],
  [/NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|DNS_/, 'dns'],
  [
    /CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|EMPTY_RESPONSE|ADDRESS_UNREACHABLE/,
    'refused'
  ],
  [/TIMED_OUT/, 'timeout'],
  [/^ERR_CERT_|SSL_|BAD_SSL|INSECURE_RESPONSE/, 'cert'],
  [/BLOCKED_BY_/, 'blocked'],
  [/PAGE_CRASHED/, 'crashed'] // not Chromium's: Panes' own, for a page whose renderer died (main/tabs.ts)
]

/** Electron's error description, like "ERR_NAME_NOT_RESOLVED", to a family. */
export function kindOf(description: string): ErrorKind {
  const d = description.toUpperCase()
  return KIND_OF.find(([re]) => re.test(d))?.[1] ?? 'generic'
}

const INFO: Record<ErrorKind, Omit<ErrorInfo, 'kind'>> = {
  offline: {
    title: "You're offline",
    message: 'Panes could not reach the internet.',
    tips: ['Check your Wi-Fi or network cable', 'Turn airplane mode off', 'Restart your router']
  },
  dns: {
    title: "We can't find that site",
    message: "The address doesn't lead anywhere, or your DNS did not answer.",
    tips: ['Check the spelling', 'Try searching for it instead', 'Check your network settings']
  },
  refused: {
    title: "That site isn't answering",
    message: 'The server is there, but it closed the door.',
    tips: [
      'It may be down for a moment, try again soon',
      'Check that the address and port are right'
    ]
  },
  timeout: {
    title: 'That took too long',
    message: 'The site did not respond in time.',
    tips: ['Your connection may be slow', 'Try again in a minute']
  },
  cert: {
    title: "This connection isn't private",
    message: "The site's security certificate could not be trusted, so Panes stopped.",
    tips: [
      'Check that your computer clock is right',
      'Do not enter passwords on this site',
      'Try the address again over a different network'
    ]
  },
  blocked: {
    title: 'Panes stopped this page',
    message: 'This page was blocked before it loaded.',
    tips: [
      'An ad blocker rule or the site itself refused the request',
      'Turn the ad blocker off in Settings to check'
    ]
  },
  crashed: {
    title: 'This page crashed',
    message: 'Something made the page stop working. The rest of Panes is fine.',
    tips: ['Reload the page', 'If it keeps happening, the page may be using too much memory']
  },
  generic: {
    title: "Can't open this page",
    message: 'Something went wrong while loading it.',
    tips: ['Try reloading the page', 'Check the address']
  }
}

/**
 * What to say about a failed load. A QUIC (HTTP/3) error alone says little: Chromium reports one for a server that went
 * down or reset its connection as much as for a network that blocks QUIC. It is put down to the network only when
 * `quicBlocked` (QUIC failed on several sites lately, see quicLooksBlocked); otherwise the site is not answering, with
 * QUIC as the last thing to try.
 */
export function describeError(description: string, quicBlocked = false): ErrorInfo {
  const kind = kindOf(description)
  if (/QUIC/i.test(description))
    return quicBlocked
      ? {
          kind: 'refused',
          title: "This network doesn't allow QUIC",
          message:
            'Sites that use a faster kind of connection (QUIC) keep failing, so your network likely blocks or breaks it.',
          tips: [
            'Turn off QUIC in Settings, under Network, and restart Panes',
            'Then everything goes over the usual kind of connection'
          ]
        }
      : {
          kind: 'refused',
          title: "That site isn't answering",
          message: 'The connection to it broke before the page came.',
          tips: [
            'It may be down for a moment, try again soon',
            'If many sites fail like this, your network may block QUIC: turn it off in Settings, under Network'
          ]
        }
  return { kind, ...INFO[kind] }
}

/** QUIC failures on this many different sites within QUIC_WINDOW_MS point at the network, not the sites. */
export const QUIC_SITES = 2
export const QUIC_WINDOW_MS = 10 * 60_000

/** A QUIC failure on `host` added to the recent ones (older ones dropped). */
export function noteQuicFailure(
  recent: ReadonlyArray<{ host: string; at: number }>,
  host: string,
  now: number
): Array<{ host: string; at: number }> {
  return [
    ...recent.filter((f) => now - f.at < QUIC_WINDOW_MS && f.host !== host),
    { host, at: now }
  ]
}

/** Whether recent QUIC failures look like the network blocking QUIC: on several different sites. */
export function quicLooksBlocked(
  recent: ReadonlyArray<{ host: string; at: number }>,
  now: number
): boolean {
  return (
    new Set(recent.filter((f) => now - f.at < QUIC_WINDOW_MS).map((f) => f.host)).size >= QUIC_SITES
  )
}

/** The address of Panes' error page for a failed load. */
export function errorPageUrl(
  failedUrl: string,
  code: number,
  description: string,
  canGoBack = false,
  theme?: { color: string; tint: number },
  /** QUIC failed on several sites lately (see quicLooksBlocked). */
  quicBlocked = false
): string {
  const q = new URLSearchParams({ url: failedUrl, code: String(code), desc: description })
  if (canGoBack) q.set('back', '1')
  if (quicBlocked) q.set('quic', '1')
  if (theme) {
    q.set('sc', theme.color)
    q.set('st', String(theme.tint))
  }
  return `panes://error/?${q.toString()}`
}

export interface ErrorParams {
  url: string
  code: number
  desc: string
  /** The tab has an earlier page to go back to. */
  back: boolean
  /** QUIC failed on several sites lately: a QUIC error is put down to the network. */
  quicBlocked: boolean
}

/** Read the page's own address bar; anything missing or odd falls back to a generic error. */
export function parseErrorParams(search: string): ErrorParams {
  const q = new URLSearchParams(search)
  const code = Number(q.get('code'))
  return {
    url: q.get('url') ?? '',
    back: q.get('back') === '1',
    quicBlocked: q.get('quic') === '1',
    code: Number.isFinite(code) ? code : 0,
    desc: /^[A-Z0-9_]{1,64}$/.test(q.get('desc') ?? '') ? (q.get('desc') as string) : 'ERR_FAILED'
  }
}

/** The space colours an error page should wear, if the address carries well-formed ones. */
export function parseSpaceTheme(search: string): { color: string; tint: number } | null {
  const q = new URLSearchParams(search)
  const color = q.get('sc') ?? ''
  const tint = Number(q.get('st'))
  if (!/^#[0-9a-f]{6}$/i.test(color) || !Number.isFinite(tint)) return null
  return { color, tint: Math.min(1, Math.max(0, tint)) }
}

/** Only web addresses are worth offering to try again; the page never navigates to anything else. */
export function retryTarget(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}
