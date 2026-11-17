// The board's measure of how hard the computer is working (see @shared/strain), shared with every live card.
// It listens passively: long animation frames the browser reports anyway, the live videos' own frame counts, the
// system's CPU pressure and the battery. No timer of its own runs frames, so measuring costs nothing to speak of.
import { useSyncExternalStore } from 'react'
import {
  CALM,
  nextStrain,
  SAMPLE_MS,
  type Pressure,
  type Strain,
  type StrainState
} from '@shared/strain'

// Chromium has these; the DOM types bundled with TypeScript do not (yet).
interface PressureRecord {
  state: Pressure
}
interface PressureObserverLike {
  observe(source: 'cpu', options?: { sampleInterval?: number }): Promise<void>
  disconnect(): void
}
type PressureObserverCtor = new (cb: (records: PressureRecord[]) => void) => PressureObserverLike
interface BatteryLike extends EventTarget {
  charging: boolean
}

let state: StrainState = CALM
let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
const listeners = new Set<() => void>()
let users = 0
let stopAll: (() => void) | null = null

const emit = (): void => {
  for (const f of listeners) f()
}

/** The live videos' frame counts last window, per element, to take deltas from. */
const seen = new WeakMap<HTMLVideoElement, { total: number; dropped: number }>()

function videoDeltas(): { frames: number; dropped: number } {
  let frames = 0
  let dropped = 0
  for (const v of document.querySelectorAll<HTMLVideoElement>('.cv-live video')) {
    if (!v.srcObject || v.paused) continue
    const q = v.getVideoPlaybackQuality()
    const was = seen.get(v)
    seen.set(v, { total: q.totalVideoFrames, dropped: q.droppedVideoFrames })
    if (!was) continue
    frames += Math.max(0, q.totalVideoFrames - was.total)
    dropped += Math.max(0, q.droppedVideoFrames - was.dropped)
  }
  return { frames, dropped }
}

function start(): () => void {
  let blocked = 0
  let pressure: Pressure | null = null
  let onBattery = false
  const undo: Array<() => void> = []

  // long animation frames (Chromium 123+); long tasks where those are missing
  try {
    const type = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
      ? 'long-animation-frame'
      : 'longtask'
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const b = (e as PerformanceEntry & { blockingDuration?: number }).blockingDuration
        blocked += b ?? Math.max(0, e.duration - 50)
      }
    })
    po.observe({ type, buffered: false })
    undo.push(() => po.disconnect())
  } catch {
    // no observer: the other signals still count
  }

  const PO = (globalThis as { PressureObserver?: PressureObserverCtor }).PressureObserver
  if (PO) {
    try {
      const o = new PO((records) => {
        const last = records[records.length - 1]
        if (last) pressure = last.state
      })
      void o.observe('cpu', { sampleInterval: SAMPLE_MS }).catch(() => undefined)
      undo.push(() => o.disconnect())
    } catch {
      // not allowed here
    }
  }

  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }
  let battery: BatteryLike | null = null
  const onCharging = (): void => {
    onBattery = !!battery && !battery.charging
  }
  void nav
    .getBattery?.()
    .then((b) => {
      battery = b
      onCharging()
      b.addEventListener('chargingchange', onCharging)
    })
    .catch(() => undefined)
  undo.push(() => battery?.removeEventListener('chargingchange', onCharging))

  const onVisibility = (): void => {
    const h = document.visibilityState === 'hidden'
    if (h === hidden) return
    hidden = h
    blocked = 0 // what ran while hidden says nothing about the board
    emit()
  }
  document.addEventListener('visibilitychange', onVisibility)
  undo.push(() => document.removeEventListener('visibilitychange', onVisibility))

  const timer = window.setInterval(() => {
    if (hidden) return
    const v = videoDeltas()
    const next = nextStrain(state, {
      blockedMs: blocked,
      videoFrames: v.frames,
      videoDropped: v.dropped,
      pressure,
      onBattery
    })
    blocked = 0
    if (next.level !== state.level) {
      state = next
      emit()
    } else state = next
  }, SAMPLE_MS)
  undo.push(() => window.clearInterval(timer))

  return () => {
    for (const f of undo) f()
    state = CALM
  }
}

function subscribe(f: () => void): () => void {
  listeners.add(f)
  if (users++ === 0) stopAll = start()
  return () => {
    listeners.delete(f)
    if (--users === 0) {
      stopAll?.()
      stopAll = null
    }
  }
}

/** The strain now (0 calm .. 3 struggling); measured while any component listens. */
export const useStrain = (): Strain =>
  useSyncExternalStore(
    subscribe,
    () => state.level,
    () => 0 as Strain
  )

/** Whether the board's window is hidden (minimised or covered): nothing streams then. */
export const useBoardHidden = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => hidden,
    () => false
  )

/** For perf scripts over CDP: `window.__panesStrain()`. */
;(globalThis as { __panesStrain?: () => { level: Strain; hidden: boolean } }).__panesStrain =
  () => ({
    level: state.level,
    hidden
  })
