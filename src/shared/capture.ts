import type { ScreenSource } from './types'

/** What the page reports (through the console) when the camera, microphone or screen starts or stops being captured. */
export const CAPTURE_PREFIX = '__panes_capture__'

export interface CaptureState {
  camera: boolean
  mic: boolean
  screen: boolean
}
export type CaptureKind = keyof CaptureState

const CAPTURE_KINDS: readonly CaptureKind[] = ['camera', 'mic', 'screen']

export const NO_CAPTURE: CaptureState = { camera: false, mic: false, screen: false }

export const isCapturing = (c: CaptureState): boolean => c.camera || c.mic || c.screen

export const sameCapture = (a: CaptureState, b: CaptureState): boolean =>
  a.camera === b.camera && a.mic === b.mic && a.screen === b.screen

/** The state in a console message, or null for any other message. */
export function parseCapture(message: string): CaptureState | null {
  if (!message.startsWith(CAPTURE_PREFIX)) return null
  try {
    const v = JSON.parse(message.slice(CAPTURE_PREFIX.length)) as Partial<CaptureState>
    return { camera: v.camera === true, mic: v.mic === true, screen: v.screen === true }
  } catch {
    return null
  }
}

/** What a page captures, from what each of its frames reports: a kind is live when any frame has it. */
export function mergeCapture(states: Iterable<CaptureState>): CaptureState {
  const out = { ...NO_CAPTURE }
  for (const s of states) for (const k of CAPTURE_KINDS) out[k] ||= s[k]
  return out
}

/**
 * How long a kind stays shown after the page stops reporting it. Call sites stop one track and start another
 * when you switch devices, mute by replacing the track, or retry getUserMedia; each of those is a gap of a
 * few hundred milliseconds that would otherwise flash the indicator off and on.
 */
export const CAPTURE_HOLD_MS = 1500

/** What a tab shows, and since when each kind it still shows has stopped being reported. */
export interface CaptureHold {
  shown: CaptureState
  offSince: Partial<Record<CaptureKind, number>>
}

export const NO_HOLD: CaptureHold = { shown: NO_CAPTURE, offSince: {} }

/**
 * The next shown state for a tab: a kind turns on as soon as it is reported and turns off only once it has
 * been unreported for CAPTURE_HOLD_MS. `settleIn` is when to look again (ms), or null when nothing is pending.
 */
export function holdCapture(
  prev: CaptureHold,
  reported: CaptureState,
  now: number
): { hold: CaptureHold; settleIn: number | null } {
  const shown = { ...NO_CAPTURE }
  const offSince: CaptureHold['offSince'] = {}
  let settleIn: number | null = null
  for (const k of CAPTURE_KINDS) {
    if (reported[k]) {
      shown[k] = true
      continue
    }
    if (!prev.shown[k]) continue
    const since = prev.offSince[k] ?? now
    const left = since + CAPTURE_HOLD_MS - now
    if (left <= 0) continue
    shown[k] = true
    offSince[k] = since
    settleIn = settleIn === null ? left : Math.min(settleIn, left)
  }
  // Keep the same object while nothing changed, so whoever renders it can tell by identity.
  return {
    hold: { shown: sameCapture(shown, prev.shown) ? prev.shown : shown, offSince },
    settleIn
  }
}

/** The capture kinds a permission covers (only camera, microphone and screen are captures). */
export function captureKindsOf(kinds: readonly string[]): CaptureKind[] {
  const out: CaptureKind[] = []
  if (kinds.includes('camera')) out.push('camera')
  if (kinds.includes('microphone')) out.push('mic')
  if (kinds.includes('screen')) out.push('screen')
  return out
}

/** Whether a share carries the system's sound: asked for by the page, wanted, and of a whole screen (a window has none). */
export const shareAudio = (sourceId: string, requested: boolean, wanted: boolean): boolean =>
  requested && wanted && sourceId.startsWith('screen:')

/** Which tab the share picker shows: the one chosen, else screens when there are any (or nothing at all yet). */
export function shareTab(
  chosen: 'screen' | 'window' | null,
  screens: number,
  windows: number
): 'screen' | 'window' {
  if (chosen) return chosen
  return screens > 0 || windows === 0 ? 'screen' : 'window'
}

/**
 * The picker lists sources in passes, one at a time: names only (no pictures, so instant), then pictures of the
 * screens, then both again every SHARE_REFRESH_MS while it is open (windows opened or closed meanwhile come and
 * go). Windows get no pictures: on Windows each window that cannot be grabbed (minimised, cloaked, protected)
 * stalls Windows Graphics Capture for 5 s waiting for a first frame, one after another.
 */
export type SharePass = 'names' | 'screens'
export const SHARE_REFRESH_MS = 2500

export function nextSharePass(done: SharePass | null): { pass: SharePass; delay: number } {
  if (done === null) return { pass: 'names', delay: 0 }
  if (done === 'names') return { pass: 'screens', delay: 0 }
  return { pass: 'names', delay: SHARE_REFRESH_MS }
}

/**
 * The picker's list after a pass over `kinds`: sources of those kinds take the pass's names and pictures (a
 * picture the pass did not bring keeps the last one), ones gone from it are dropped (a closed window), new ones
 * are added at the end, and the order of the rest never changes under the pointer. Sources of other kinds stay.
 */
export function mergeSources(
  list: readonly ScreenSource[],
  pass: readonly ScreenSource[],
  kinds: readonly ScreenSource['kind'][]
): ScreenSource[] {
  const fresh = new Map(pass.map((s) => [s.id, s]))
  const out: ScreenSource[] = []
  for (const s of list) {
    if (!kinds.includes(s.kind)) {
      out.push(s)
      continue
    }
    const f = fresh.get(s.id)
    if (!f) continue
    out.push({ ...s, name: f.name || s.name, thumb: f.thumb || s.thumb, icon: f.icon || s.icon })
    fresh.delete(s.id)
  }
  for (const f of fresh.values()) if (kinds.includes(f.kind)) out.push(f)
  return out
}

/** Script that ends what a page captures of the given kinds (see `window.__panesCapture` below). */
export const stopCaptureScript = (kinds: readonly CaptureKind[]): string =>
  `typeof window.__panesCapture === 'function' && window.__panesCapture(${JSON.stringify(kinds)})`

/**
 * Installed in a frame only once it has been allowed to use the camera, microphone or screen, never before: a
 * wrapped getUserMedia is something bot checks can see, and an ordinary page has no reason to carry one. It
 * wraps getUserMedia and getDisplayMedia, follows the tracks they hand out, and reports which kinds are live.
 * A page that calls track.stop() fires no event, so live tracks are looked at once a second. The page's own
 * behaviour is untouched. `window.__panesCapture(kinds)` ends the tracks of those kinds, for when access is
 * blocked while in use; it fires `ended` on them as the browser itself does, so the page's UI follows.
 */
export const CAPTURE_SCRIPT = `(() => {
  const md = navigator.mediaDevices
  if (!md || window.__panesCapture) return
  const live = new Set()
  let last = ''
  const kindOf = (t) =>
    t.kind === 'audio' ? 'mic' : t.getSettings && t.getSettings().displaySurface ? 'screen' : 'camera'
  const report = () => {
    const now = { camera: false, mic: false, screen: false }
    for (const t of [...live]) {
      if (t.readyState === 'ended') { live.delete(t); continue }
      now[kindOf(t)] = true
    }
    const text = JSON.stringify(now)
    if (text !== last) { last = text; console.debug('${CAPTURE_PREFIX}' + text) }
  }
  const watch = (t) => {
    if (live.has(t)) return
    live.add(t)
    t.addEventListener('ended', report)
  }
  window.__panesCapture = (kinds) => {
    for (const t of [...live]) {
      if (!kinds.includes(kindOf(t)) || t.readyState === 'ended') continue
      t.stop()
      t.dispatchEvent(new Event('ended'))
    }
    report()
  }
  for (const name of ['getUserMedia', 'getDisplayMedia']) {
    const original = md[name]
    if (typeof original !== 'function') continue
    md[name] = function (...args) {
      return original.apply(this, args).then((stream) => {
        for (const t of stream.getTracks()) watch(t)
        report()
        return stream
      })
    }
  }
  // The page's own first request was already under way when this was installed, so also look at what is playing
  // in media elements (a track with a device id is ours, a remote one has none).
  const scan = () => {
    for (const el of document.querySelectorAll('video, audio')) {
      const s = el.srcObject
      if (!s || typeof s.getTracks !== 'function') continue
      for (const t of s.getTracks()) if (t.readyState === 'live' && t.getSettings && t.getSettings().deviceId) watch(t)
    }
  }
  scan()
  report()
  setInterval(() => { scan(); if (live.size > 0) report() }, 1000)
})()`
