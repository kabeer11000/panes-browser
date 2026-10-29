/** What a site can ask permission for. Camera and microphone are asked together when a page wants both. */
export type PermKind =
  | 'camera'
  | 'microphone'
  | 'location'
  | 'notifications'
  | 'clipboard'
  | 'screen'
  | 'midi'
  | 'windows'
export type PermDecision = 'allow' | 'block'
/** What the site settings offer for one kind: a remembered answer, or asking each time. */
export type PermSetting = PermDecision | 'ask'

export interface SiteGrant {
  origin: string
  kind: PermKind
  decision: PermDecision
  /** "Allow this time": when it lapses (ms since epoch). Absent for an answer kept until changed. */
  expires?: number
}

/** Every kind, in the order the settings list them: the everyday ones first. */
export const PERM_KINDS: readonly PermKind[] = [
  'camera',
  'microphone',
  'location',
  'notifications',
  'screen',
  'clipboard',
  'midi',
  'windows'
]

export const PERM_LABEL: Record<PermKind, string> = {
  camera: 'Camera',
  microphone: 'Microphone',
  location: 'Location',
  notifications: 'Notifications',
  clipboard: 'Clipboard',
  screen: 'Screen sharing',
  midi: 'MIDI devices',
  windows: 'Window placement'
}

/** How the prompt names each kind after "wants to use your". */
const PERM_NOUN: Record<PermKind, string> = {
  camera: 'camera',
  microphone: 'microphone',
  location: 'location',
  notifications: 'notifications',
  clipboard: 'clipboard',
  screen: 'screen',
  midi: 'MIDI devices',
  windows: 'displays to place windows'
}

/** How long "Allow this time" lasts. Long enough for a call, short enough that it is not a quiet Allow. */
export const ONCE_MS = 60 * 60 * 1000

/** Granted to every page without asking: they cannot read anything about you or reach hardware. */
export const ALWAYS_ALLOWED: ReadonlySet<string> = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'keyboardLock',
  'screen-wake-lock', // keeps the display on during a video or a recipe, as Chrome allows by default
  'mediaKeySystem' // DRM video such as Netflix
])

/**
 * The kinds a permission request needs answered, or null when it is not one Panes asks about
 * (those are refused). `mediaTypes` is Electron's list of what a `media` request wants.
 */
export function kindsFor(
  permission: string,
  mediaTypes: readonly string[] = []
): PermKind[] | null {
  switch (permission) {
    case 'media': {
      const kinds: PermKind[] = []
      if (mediaTypes.includes('video')) kinds.push('camera')
      if (mediaTypes.includes('audio')) kinds.push('microphone')
      // getDisplayMedia arrives as a `media` request that names no device type: it is screen sharing
      return kinds.length > 0 ? kinds : ['screen']
    }
    case 'geolocation':
    case 'geolocation-approximate':
      return ['location']
    case 'notifications':
      return ['notifications']
    case 'clipboard-read':
      return ['clipboard']
    case 'display-capture':
      return ['screen']
    case 'midi':
    case 'midiSysex':
      return ['midi']
    case 'window-management':
      return ['windows']
    default:
      return null
  }
}

/** What stored decisions say about a request: all allowed, any blocked, or still to ask. */
export function resolveKinds(
  kinds: readonly PermKind[],
  decisionOf: (kind: PermKind) => PermDecision | undefined
): PermDecision | 'ask' {
  const decisions = kinds.map(decisionOf)
  if (decisions.includes('block')) return 'block'
  return decisions.every((d) => d === 'allow') ? 'allow' : 'ask'
}

/** The origin of a requesting URL, or null for anything that is not a normal web origin. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

/**
 * Whose decision a request or a check is, or null when it is refused outright. Like Chrome, a frame asks on
 * behalf of the page it is in (the frame's own permissions policy was already enforced by Chromium), so one
 * answer per site covers its embedded call widget or map, and the prompt and the site settings name the site
 * you can see. A cross-origin frame never gets notifications. `topUrl` is undefined when there is no page at
 * all (a service worker): then the requester is the site.
 */
export function permissionOrigin(
  kinds: readonly PermKind[],
  requestingUrl: string,
  topUrl: string | undefined
): string | null {
  const own = originOf(requestingUrl)
  if (topUrl === undefined || !own) return own
  const top = originOf(topUrl)
  if (!top) return null
  if (top !== own && kinds.includes('notifications')) return null
  return top
}

/** The answer in force for one kind on one site; a lapsed "this time" answer is no answer. */
export function grantIn(
  grants: readonly SiteGrant[],
  origin: string,
  kind: PermKind,
  now: number
): SiteGrant | undefined {
  const g = grants.find((x) => x.origin === origin && x.kind === kind)
  return g && (g.expires === undefined || g.expires > now) ? g : undefined
}

export const decisionIn = (
  grants: readonly SiteGrant[],
  origin: string,
  kind: PermKind,
  now: number
): PermDecision | undefined => grantIn(grants, origin, kind, now)?.decision

/** `grants` with one site's answer for `kinds` replaced: by `decision`, or by nothing (ask again) for null. */
export function withDecision(
  grants: readonly SiteGrant[],
  origin: string,
  kinds: readonly PermKind[],
  decision: PermDecision | null,
  expires?: number
): SiteGrant[] {
  const rest = grants.filter((g) => !(g.origin === origin && kinds.includes(g.kind)))
  if (!decision) return rest
  return [
    ...rest,
    ...kinds.map((kind) =>
      expires === undefined ? { origin, kind, decision } : { origin, kind, decision, expires }
    )
  ]
}

/** The answers still in force. */
export function liveGrants(grants: readonly SiteGrant[], now: number): SiteGrant[] {
  return grants.filter((g) => g.expires === undefined || g.expires > now)
}

export const isPermKind = (v: unknown): v is PermKind => PERM_KINDS.includes(v as PermKind)

/** Saved answers read back from disk, keeping only well-formed, permanent ones (one per site and kind). */
export function sanitizeGrants(raw: unknown): SiteGrant[] {
  if (!Array.isArray(raw)) return []
  let out: SiteGrant[] = []
  for (const g of raw as Array<Partial<SiteGrant> | null>) {
    const origin = typeof g?.origin === 'string' ? originOf(g.origin) : null
    if (!origin || !isPermKind(g?.kind) || (g.decision !== 'allow' && g.decision !== 'block'))
      continue
    out = withDecision(out, origin, [g.kind], g.decision)
  }
  return out
}

/** What a page was told about one kind, and what the setting was then. */
export interface PageAnswer {
  granted: boolean
  setting: PermSetting
}
/** What the document in a tab has been told since it loaded, per kind. */
export type PageAnswers = Partial<Record<PermKind, PageAnswer>>

/**
 * Taking these back does not reach what the page already holds (a running location watch, an open MIDI port,
 * screen details), so the page has to reload. Camera, microphone and screen are stopped in the page instead,
 * and notifications and clipboard reads are checked every time they are used.
 */
const REVOKE_NEEDS_RELOAD: ReadonlySet<PermKind> = new Set<PermKind>([
  'location',
  'midi',
  'windows'
])

/**
 * The kinds whose current setting the page will only see after a reload. Chromium tells a page nothing when a
 * setting changes (navigator.permissions has no change events in Electron, and a refused page has usually
 * given up asking), so: a page that was refused and may now have access, or a page holding access that has
 * been blocked and cannot be taken back from it live. A setting back where it was needs nothing.
 */
export function staleKinds(
  answers: PageAnswers,
  settingOf: (kind: PermKind) => PermSetting
): PermKind[] {
  const out: PermKind[] = []
  for (const kind of PERM_KINDS) {
    const told = answers[kind]
    if (!told) continue
    const now = settingOf(kind)
    if (now === told.setting) continue
    if (told.granted ? now === 'block' && REVOKE_NEEDS_RELOAD.has(kind) : now !== 'block') {
      out.push(kind)
    }
  }
  return out
}

/** "camera and microphone", "location": the phrase the prompt puts after "wants to use your". */
export function describeKinds(kinds: readonly PermKind[]): string {
  const names = kinds.map((k) => PERM_NOUN[k])
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : names[0]
}
