/** The families of failed page loads Panes has a custom page for. */
export type ErrorKind = 'offline' | 'dns' | 'refused' | 'timeout' | 'cert' | 'blocked' | 'generic'

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
  [/BLOCKED_BY_/, 'blocked']
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
  generic: {
    title: "Can't open this page",
    message: 'Something went wrong while loading it.',
    tips: ['Try reloading the page', 'Check the address']
  }
}

export function describeError(description: string): ErrorInfo {
  const kind = kindOf(description)
  return { kind, ...INFO[kind] }
}

/** The address of Panes' error page for a failed load. */
export function errorPageUrl(
  failedUrl: string,
  code: number,
  description: string,
  canGoBack = false,
  theme?: { color: string; tint: number }
): string {
  const q = new URLSearchParams({ url: failedUrl, code: String(code), desc: description })
  if (canGoBack) q.set('back', '1')
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
}

/** Read the page's own address bar; anything missing or odd falls back to a generic error. */
export function parseErrorParams(search: string): ErrorParams {
  const q = new URLSearchParams(search)
  const code = Number(q.get('code'))
  return {
    url: q.get('url') ?? '',
    back: q.get('back') === '1',
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
