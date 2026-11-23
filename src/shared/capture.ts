import type { ScreenSource } from './types'

/** What the page reports (through the console) when the camera, microphone or screen starts or stops being captured. */
export const CAPTURE_PREFIX = '__panes_capture__'

export interface CaptureState {
  camera: boolean
  mic: boolean
  screen: boolean
  /** The microphone is held but muted in the page (every live mic track disabled, as call sites mute). */
  micMuted?: boolean
}
export type CaptureKind = 'camera' | 'mic' | 'screen'

const CAPTURE_KINDS: readonly CaptureKind[] = ['camera', 'mic', 'screen']

export const NO_CAPTURE: CaptureState = { camera: false, mic: false, screen: false }

export const isCapturing = (c: CaptureState): boolean => c.camera || c.mic || c.screen

export const sameCapture = (a: CaptureState, b: CaptureState): boolean =>
  a.camera === b.camera && a.mic === b.mic && a.screen === b.screen && !a.micMuted === !b.micMuted

/** The state in a console message, or null for any other message. */
export function parseCapture(message: string): CaptureState | null {
  if (!message.startsWith(CAPTURE_PREFIX)) return null
  try {
    const v = JSON.parse(message.slice(CAPTURE_PREFIX.length)) as Partial<CaptureState>
    const mic = v.mic === true
    return {
      camera: v.camera === true,
      mic,
      screen: v.screen === true,
      ...(mic && v.micMuted === true ? { micMuted: true } : {})
    }
  } catch {
    return null
  }
}

/** What a page captures, from what each of its frames reports: a kind is live when any frame has it. */
export function mergeCapture(states: Iterable<CaptureState>): CaptureState {
  const out: CaptureState = { ...NO_CAPTURE }
  // muted only when every frame holding the mic has it muted
  let live = 0
  let muted = 0
  for (const s of states) {
    for (const k of CAPTURE_KINDS) out[k] ||= s[k]
    if (s.mic) {
      live++
      if (s.micMuted) muted++
    }
  }
  if (live > 0 && muted === live) out.micMuted = true
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
  const shown: CaptureState = { ...NO_CAPTURE }
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
  // muting is shown at once (no hold): it is a state of a live mic, not a gap in one
  if (shown.mic && reported.mic && reported.micMuted) shown.micMuted = true
  else if (shown.mic && !reported.mic && prev.shown.micMuted) shown.micMuted = true
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
/** Seldom: on Windows a pass holds Panes' main thread for half a second or more (everything stops with it). */
export const SHARE_REFRESH_MS = 10_000

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

/**
 * Follows what a page captures (camera, microphone, screen) and tells main (`report` gets the JSON that follows
 * CAPTURE_PREFIX, sent only when it changes), for the tab's call and sharing badges. Run by the frame preload in the
 * page's world at document start, in every frame: put in later (as it was, once the site had been allowed), it
 * missed the page's first request, already under way, and an audio-only call (nothing shown in a video element) was
 * never seen at all. getUserMedia and getDisplayMedia are wrapped on the prototype in a Proxy, so they still read as
 * native; tracks they hand out, and clones of those, are followed. A page that calls track.stop() fires no event, so
 * while anything is live it is looked at once a second (no timer otherwise). `onStop(kinds)` ends the tracks of
 * those kinds (access blocked while in use, the Stop sharing button), firing `ended` as the browser does, so the
 * page's own UI follows.
 *
 * Self-contained (no imports or outer names): Electron runs it from its source text.
 */
export function captureShim(
  bridge: { report: (data: string) => void; onStop: (cb: (kinds: string[]) => void) => void },
  g: typeof globalThis = globalThis
): void {
  const proto = g.MediaDevices?.prototype
  if (!proto) return
  const live = new Set<MediaStreamTrack>()
  let last = ''
  let timer: ReturnType<typeof setInterval> | undefined
  const kindOf = (t: MediaStreamTrack): 'mic' | 'screen' | 'camera' =>
    t.kind === 'audio'
      ? 'mic'
      : (t.getSettings?.() as { displaySurface?: string } | undefined)?.displaySurface
        ? 'screen'
        : 'camera'
  const report = (): void => {
    const now = { camera: false, mic: false, screen: false, micMuted: false }
    let mics = 0
    let mutedMics = 0
    for (const t of [...live]) {
      if (t.readyState === 'ended') live.delete(t)
      else {
        const k = kindOf(t)
        now[k] = true
        if (k === 'mic') {
          mics++
          // a call mutes by disabling its track (it stays live); the 1 s look below catches the change
          if (!t.enabled) mutedMics++
        }
      }
    }
    now.micMuted = mics > 0 && mutedMics === mics
    const text = JSON.stringify(now)
    if (text !== last) {
      last = text
      bridge.report(text)
    }
    if (live.size > 0 && timer === undefined) timer = g.setInterval(report, 1000)
    else if (live.size === 0 && timer !== undefined) {
      g.clearInterval(timer)
      timer = undefined
    }
  }
  const watch = (t: MediaStreamTrack): void => {
    if (live.has(t)) return
    live.add(t)
    t.addEventListener('ended', report)
  }
  for (const name of ['getUserMedia', 'getDisplayMedia'] as const) {
    const original = proto[name]
    if (typeof original !== 'function') continue
    proto[name] = new Proxy(original, {
      apply: (target, self, args) =>
        (Reflect.apply(target, self, args) as Promise<MediaStream>).then((stream) => {
          for (const t of stream.getTracks()) watch(t)
          report()
          return stream
        })
    })
  }
  const track = g.MediaStreamTrack?.prototype
  if (track && typeof track.clone === 'function') {
    track.clone = new Proxy(track.clone, {
      apply: (target, self: MediaStreamTrack, args) => {
        const copy = Reflect.apply(target, self, args) as MediaStreamTrack
        if (live.has(self)) {
          watch(copy)
          report()
        }
        return copy
      }
    })
  }
  bridge.onStop((kinds) => {
    for (const t of [...live]) {
      if (!kinds.includes(kindOf(t)) || t.readyState === 'ended') continue
      t.stop()
      t.dispatchEvent(new Event('ended'))
    }
    report()
  })
}
