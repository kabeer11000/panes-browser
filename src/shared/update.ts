/** Where the app is in checking for, downloading and applying an update. */
export type UpdateState =
  | { kind: 'disabled'; reason: string }
  | { kind: 'idle'; checkedAt: number | null }
  | { kind: 'checking'; checkedAt: number | null }
  | { kind: 'available'; version: string; notes: string }
  | {
      kind: 'downloading'
      version: string
      notes: string
      percent: number
      bytesPerSecond: number
    }
  | { kind: 'ready'; version: string; notes: string }
  /** Restart was chosen: Panes is closing and the installer is putting the new version in place. */
  | { kind: 'installing'; version: string }
  | { kind: 'error'; message: string; checkedAt: number | null }

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'none'; at: number }
  | { type: 'found'; version: string; notes: string }
  | { type: 'progress'; percent: number; bytesPerSecond: number }
  | { type: 'downloaded' }
  | { type: 'installing' }
  | { type: 'error'; message: string; at: number }

const MAX_MESSAGE = 200

const checkedAtOf = (s: UpdateState): number | null =>
  s.kind === 'idle' || s.kind === 'checking' || s.kind === 'error' ? s.checkedAt : null

/**
 * The one place update state changes. A disabled build stays disabled, and a downloaded update is never
 * undone by a later check or error: the only way out of "ready" is restarting into it.
 */
export function nextUpdateState(s: UpdateState, e: UpdateEvent): UpdateState {
  if (e.type === 'installing')
    return s.kind === 'ready' ? { kind: 'installing', version: s.version } : s
  if (s.kind === 'disabled' || s.kind === 'ready' || s.kind === 'installing') return s
  switch (e.type) {
    case 'checking':
      // Already past checking: a second check must not drag a download back to the start.
      return s.kind === 'available' || s.kind === 'downloading'
        ? s
        : { kind: 'checking', checkedAt: checkedAtOf(s) }
    case 'none':
      return { kind: 'idle', checkedAt: e.at }
    case 'found':
      return { kind: 'available', version: e.version, notes: e.notes }
    case 'progress':
      if (s.kind !== 'available' && s.kind !== 'downloading') return s
      return {
        kind: 'downloading',
        version: s.version,
        notes: s.notes,
        percent: Math.round(Math.min(100, Math.max(0, e.percent)) * 10) / 10,
        bytesPerSecond: Math.max(0, e.bytesPerSecond)
      }
    case 'downloaded':
      return s.kind === 'available' || s.kind === 'downloading'
        ? { kind: 'ready', version: s.version, notes: s.notes }
        : s
    case 'error':
      return { kind: 'error', message: e.message.slice(0, MAX_MESSAGE), checkedAt: e.at }
  }
}

/** What went wrong, in words a person can act on. Raw network and HTTP errors are not those words. */
export function friendlyUpdateError(raw: string): string {
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET|ERR_NETWORK|ERR_CONNECTION/i.test(
      raw
    )
  ) {
    return "Can't reach the update server. Check your internet connection."
  }
  if (/\b(401|403)\b|Bad credentials|authentication|Unauthorized|Forbidden/i.test(raw)) {
    return 'The update server refused access. If the release repository is private, updates need a token.'
  }
  if (/\b404\b|Not Found|Cannot find latest|No published versions/i.test(raw)) {
    return 'No published release was found yet.'
  }
  const first = raw.split('\n')[0].trim()
  return first ? first.slice(0, 160) : 'Something went wrong while checking for updates.'
}

/** Release notes arrive as a string of HTML, or a list of per-version notes. Show them as plain text. */
export function notesText(raw: unknown): string {
  const flat = Array.isArray(raw)
    ? raw
        .map((n) =>
          n && typeof n === 'object' ? String((n as { note?: unknown }).note ?? '') : ''
        )
        .join('\n\n')
    : typeof raw === 'string'
      ? raw
      : ''
  return flat
    .replace(/<\s*br\s*\/?>|<\/(p|li|h[1-6]|div)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** "1.2 MB/s" for the download readout. */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`
  const kb = bytesPerSecond / 1024
  if (kb < 1024) return `${Math.round(kb)} KB/s`
  return `${(kb / 1024).toFixed(1)} MB/s`
}
