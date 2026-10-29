/** What a site can ask permission for. Camera and microphone are asked together when a page wants both. */
export type PermKind =
  'camera' | 'microphone' | 'location' | 'notifications' | 'clipboard' | 'screen'
export type PermDecision = 'allow' | 'block'

export interface SiteGrant {
  origin: string
  kind: PermKind
  decision: PermDecision
}

export const PERM_LABEL: Record<PermKind, string> = {
  camera: 'Camera',
  microphone: 'Microphone',
  location: 'Location',
  notifications: 'Notifications',
  clipboard: 'Clipboard',
  screen: 'Screen sharing'
}

/** Granted to every page without asking: they cannot read anything about you or reach hardware. */
export const ALWAYS_ALLOWED: ReadonlySet<string> = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'keyboardLock',
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
      return kinds.length > 0 ? kinds : null
    }
    case 'geolocation':
      return ['location']
    case 'notifications':
      return ['notifications']
    case 'clipboard-read':
      return ['clipboard']
    case 'display-capture':
      return ['screen']
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

/** "camera and microphone", "location": the phrase the prompt puts after "wants to use". */
export function describeKinds(kinds: readonly PermKind[]): string {
  const names = kinds.map((k) => PERM_LABEL[k].toLowerCase())
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : names[0]
}
