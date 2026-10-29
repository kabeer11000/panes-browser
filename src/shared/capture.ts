/** What the page reports (through the console) when the camera, microphone or screen starts or stops being captured. */
export const CAPTURE_PREFIX = '__panes_capture__'

export interface CaptureState {
  camera: boolean
  mic: boolean
  screen: boolean
}

export const NO_CAPTURE: CaptureState = { camera: false, mic: false, screen: false }

export const isCapturing = (c: CaptureState): boolean => c.camera || c.mic || c.screen

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

/**
 * Runs at the start of every document. It wraps getUserMedia and getDisplayMedia, follows the tracks they
 * hand out, and reports which kinds are live. A page that calls track.stop() fires no event, so live tracks
 * are looked at once a second. The page's own behaviour is untouched.
 */
export const CAPTURE_SCRIPT = `(() => {
  const md = navigator.mediaDevices
  if (!md || window.__panesCapture) return
  window.__panesCapture = true
  const live = new Set()
  let last = ''
  const report = () => {
    let camera = false, mic = false, screen = false
    for (const t of [...live]) {
      if (t.readyState === 'ended') { live.delete(t); continue }
      if (t.kind === 'audio') mic = true
      else if (t.getSettings && t.getSettings().displaySurface) screen = true
      else camera = true
    }
    const text = JSON.stringify({ camera, mic, screen })
    if (text !== last) { last = text; console.debug('${CAPTURE_PREFIX}' + text) }
  }
  const take = (stream) => {
    for (const t of stream.getTracks()) { live.add(t); t.addEventListener('ended', report) }
    report()
    return stream
  }
  for (const name of ['getUserMedia', 'getDisplayMedia']) {
    const original = md[name]
    if (typeof original !== 'function') continue
    md[name] = function (...args) { return original.apply(this, args).then(take) }
  }
  setInterval(() => { if (live.size > 0) report() }, 1000)
})()`
