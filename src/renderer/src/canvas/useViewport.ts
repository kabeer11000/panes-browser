import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Viewport } from '@shared/ai/canvas'
import { boardMoved, onBoardMotion } from './boardMotion'
import { noteBoardFrame } from './strain'
import { dotAlpha, placeGrid } from '@shared/gridDots'
import { Camera } from '@shared/boardPhysics'
import { SPRINGS, type SpringParams } from '@shared/spring'
import { reducedMotion } from '@renderer/motion'

/**
 * The elements whose styles read the zoom in canvas.css. --vk (the zoom itself): the bars over a selection, which keep
 * their size on screen. --hs (the label scale): labels, handles and outlines, and it only changes below 62% zoom.
 * Each is set on these elements directly, so a frame of a zoom restyles a handful and not every card under the root.
 * Add a selector here when a new rule reads either property.
 */
const VK_READERS = '.cv-fbar, .cv-kbar, .cv-mbar, .cv-blabel-in'
const HS_READERS = [
  '.cv-badges',
  '.cv-count',
  '.cv-crz',
  '.cv-frame',
  '.cv-frame-head',
  '.cv-guides',
  '.cv-handle',
  '.cv-kend',
  '.cv-mark-handles',
  '.cv-nrz',
  '.cv-rz',
  '.cv-splithead'
].join(', ')

const hsOf = (k: number): string => String(Math.min(2.6, Math.max(1, 0.62 / k)))
let lastHs = '1'
/**
 * --fhs, a section header's scale: it grows as the board shrinks below 95%, without a cap, so the name keeps about the
 * same size on screen at any zoom and nothing switches (a separate name took over below 22% before, a jump).
 */
const FHS_READERS = '.cv-frame-head'
const fhsOf = (k: number): string => String(Math.max(1, 0.95 / k))

/**
 * The zoom on the elements that read it (a shared style rule changed each frame cost Chromium a rebuild of its style
 * sheet each time). The root gets both too once the board settles (rootZoom), for whatever is drawn later.
 */
function zoomVars(root: HTMLElement, k: number): void {
  const vk = String(k)
  for (const el of root.querySelectorAll<HTMLElement>(VK_READERS)) el.style.setProperty('--vk', vk)
  const fhs = fhsOf(k)
  for (const el of root.querySelectorAll<HTMLElement>(FHS_READERS))
    el.style.setProperty('--fhs', fhs)
  const hs = hsOf(k)
  if (hs === lastHs) return
  lastHs = hs
  for (const el of root.querySelectorAll<HTMLElement>(HS_READERS)) el.style.setProperty('--hs', hs)
}

function rootZoom(root: HTMLElement, k: number): void {
  root.style.setProperty('--vk', String(k))
  root.style.setProperty('--hs', hsOf(k))
  root.style.setProperty('--fhs', fhsOf(k))
}

export const MIN_K = 0.08
export const MAX_K = 2.5
const clampK = (k: number): number => Math.min(MAX_K, Math.max(MIN_K, k))

/** A wheel notch's pan, smoothed: quick and critically damped, so it glides without feeling late. */
const WHEEL_PAN: SpringParams = { response: 0.13, damping: 1 }
/** A mouse wheel's zoom notch: a short glide to the next step. */
const NOTCH_ZOOM: SpringParams = { response: 0.2, damping: 1 }
/** A pinch: barely behind the fingers, only the jitter of the reports smoothed away. */
const PINCH_ZOOM: SpringParams = { response: 0.1, damping: 1 }
/** A zoom input's end: no report for this long. */
const ZOOM_END_MS = 120
/** After a pinch the zoom carries on a little (Park's halves every ~230 ms): its last speed times this, in s. */
const PINCH_CARRY_S = 0.12

/** Efficient mode (Settings): shorter motion, nothing optional. */
const lowFx = (): boolean => document.documentElement.dataset.fx === 'low'

/** How often a moving board says where it will come to rest (see onHeading). */
const HEADING_MS = 90

/**
 * The board's pan and zoom. The view lives in a ref and is written straight to the DOM (one transform on the board
 * layer, the dots' position on the grid element, and the label scale on the root when the zoom changes), so a pan never
 * re-renders React. `onMove` is told after every change, throttled to one call per frame.
 *
 * Every movement is one Camera (shared/boardPhysics) stepped once a frame: a wheel's zoom chases its target on a spring
 * about the cursor and gives a little past its limits, a wheel notch's pan glides, a fling coasts, and a glide
 * (animateTo) springs x, y and the log of the zoom together. Input arriving mid-motion retargets it, keeping its speed.
 */
export function useViewport(
  initial: Viewport,
  onMove: (v: Viewport) => void,
  /** Where the motion in flight will come to rest (Camera.restingView), told now and then while it moves. */
  onHeading?: (rest: Viewport) => void
): {
  root: React.RefObject<HTMLDivElement | null>
  /** The dotted background: it alone gets the per-pan properties. */
  grid: React.RefObject<HTMLDivElement | null>
  layer: React.RefObject<HTMLDivElement | null>
  get: () => Viewport
  set: (v: Viewport) => void
  panBy: (dx: number, dy: number) => void
  zoomAt: (factor: number, cx: number, cy: number) => void
  /** A wheel's pan (screen px): a notch (`smooth`) glides there, a touchpad's fine steps move at once. */
  wheelPan: (dx: number, dy: number, smooth: boolean) => void
  /** A wheel's zoom by `dl` (log units) about a screen point; `pinch`: a touchpad's fine steps, with a short carry. */
  wheelZoom: (dl: number, cx: number, cy: number, pinch: boolean) => void
  animateTo: (v: Viewport, ms?: number) => void
  /** Carry on at (vx, vy) px/ms, slowing with time constant `tau` ms (0: not at all). */
  fling: (vx: number, vy: number, tau?: number) => void
  /** The fingers of a pinch lifted (the touchpad's raw contacts say so): end it now. */
  pinchLift: () => void
  stop: () => void
  /** Put the board on its own layer now: a movement is about to start (fingers down on the touchpad). */
  warm: () => void
} {
  const root = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const lastK = useRef(NaN)
  /** The fine dots' spacing as last painted (the grid layer is scaled from it to the true one, see gridDots). */
  const painted = useRef(NaN)
  const view = useRef<Viewport>(initial)
  const cam = useRef<Camera | null>(null)
  const camera = (): Camera => (cam.current ??= new Camera(initial, MIN_K, MAX_K))
  const raf = useRef(0)
  const lastFrame = useRef(0)
  const moved = useRef(onMove)
  useEffect(() => {
    moved.current = onMove
  }, [onMove])
  const heading = useRef(onHeading)
  useEffect(() => {
    heading.current = onHeading
  }, [onHeading])
  /** When the resting place was last told (it is worked out at most every HEADING_MS). */
  const headingAt = useRef(0)
  /**
   * The dots: they slide as one layer, by the pan modulo one coarse tile, so a pan never repaints them (moving a painted
   * background was a full-screen repaint a frame). A zoom scales that layer too, and repaints the dots only now and
   * then (`exact`: at the true spacing, once the board settles); see shared/gridDots.
   */
  const placeDots = useCallback((exact: boolean): void => {
    const g = grid.current
    if (!g) return
    const v = view.current
    const p = placeGrid(v.x, v.y, v.k, painted.current, exact)
    if (p.repaint) {
      painted.current = p.painted
      g.style.setProperty('--ds', `${p.painted}px`)
      g.style.setProperty('--ds2', `${p.painted * 4}px`)
      g.style.setProperty('--da', dotAlpha(p.painted).toFixed(3))
    }
    g.style.transform = `translate3d(${p.tx}px, ${p.ty}px, 0) scale(${p.scale})`
  }, [])
  // the board settled: the zoom goes on the root as well, once, for what is drawn later (see zoomVars), and the dots
  // are repainted sharp at their true spacing
  useEffect(
    () =>
      onBoardMotion((m) => {
        if (m) return
        if (root.current) rootZoom(root.current, view.current.k)
        placeDots(true)
      }),
    [placeDots]
  )
  const pending = useRef(false)
  const idle = useRef(0)

  /**
   * The board on its own layer for a while: while it moves, and a little after. Gaining or losing the layer redraws
   * the whole board, a frame's work, so it is kept through the pauses inside one movement (a pan's fingers hardly
   * ever move without a break), and taken ahead of time when a movement is about to start.
   */
  const warm = useCallback((): void => {
    const r = root.current
    if (!r) return
    r.classList.add('moving')
    window.clearTimeout(idle.current)
    idle.current = window.setTimeout(() => r.classList.remove('moving'), 800)
  }, [])

  const paint = useCallback((): void => {
    const v = view.current
    const l = layer.current
    if (l) l.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.k})`
    const r = root.current
    warm() // the board is on its own layer only while it moves
    boardMoved()
    if (r) {
      // Custom properties inherit: one set on the root makes every card, label and arrow under it recompute its
      // style, every frame of a pan or a zoom (most of a zoom's cost). The dots' position goes on the grid alone,
      // and what the board's contents read (--vk, --hs) goes on the few elements that read it (zoomVars).
      if (v.k !== lastK.current) {
        lastK.current = v.k
        zoomVars(r, v.k)
      }
      placeDots(false)
    }
    if (!pending.current) {
      pending.current = true
      requestAnimationFrame(() => {
        pending.current = false
        moved.current(view.current)
      })
    }
  }, [warm, placeDots])

  /** The camera's view, written to the page. */
  const show = useCallback((): void => {
    view.current = (cam.current ??= new Camera(initial, MIN_K, MAX_K)).view
    paint()
    // the initial view is only read once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // one frame loop for every motion of the camera; it ends itself once the camera is still
  const frame = useRef<FrameRequestCallback>(() => undefined)
  useEffect(() => {
    frame.current = (now) => {
      const c = cam.current
      if (!c) return
      // a dropped frame or a hidden window: never more than 1/20 s in one step (exact, but keep it visible)
      if (lastFrame.current) noteBoardFrame(now - lastFrame.current) // for the strain (canvas/strain.ts)
      const dt = Math.min(0.05, lastFrame.current ? (now - lastFrame.current) / 1000 : 1 / 60)
      lastFrame.current = now
      c.step(dt)
      show()
      if (c.moving && heading.current && now - headingAt.current >= HEADING_MS) {
        headingAt.current = now
        heading.current(c.restingView)
      }
      if (c.moving) raf.current = requestAnimationFrame(frame.current)
      else {
        raf.current = 0
        lastFrame.current = 0
      }
    }
  }, [show])
  const run = useCallback((): void => {
    if (raf.current) return
    lastFrame.current = 0
    raf.current = requestAnimationFrame((t) => frame.current(t))
  }, [])

  const zoomEnd = useRef(0)
  /** How the pinch in flight ends (its carry and release), for pinchLift to run at once. */
  const pinchEnd = useRef<(() => void) | null>(null)
  /** The last pinch reports (time, log zoom asked so far), for the carry after it. */
  const pinchTrail = useRef<Array<{ t: number; l: number }>>([])

  const stop = useCallback((): void => {
    cam.current?.stop()
    cancelAnimationFrame(raf.current)
    raf.current = 0
    window.clearTimeout(zoomEnd.current)
    pinchEnd.current = null
  }, [])

  const set = useCallback(
    (v: Viewport): void => {
      stop()
      camera().set({ x: v.x, y: v.y, k: clampK(v.k) })
      show()
    },
    // camera() only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [show, stop]
  )

  const panBy = useCallback(
    (dx: number, dy: number): void => {
      camera().panBy(dx, dy)
      show()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [show]
  )

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number): void => {
      const v = view.current
      const k = clampK(v.k * factor)
      const f = k / v.k
      set({ k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f })
    },
    [set]
  )

  const wheelPan = useCallback(
    (dx: number, dy: number, smooth: boolean): void => {
      if (!smooth || reducedMotion()) return panBy(dx, dy)
      camera().panSmooth(dx, dy, WHEEL_PAN)
      run()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panBy, run]
  )

  const wheelZoom = useCallback(
    (dl: number, cx: number, cy: number, pinch: boolean): void => {
      if (reducedMotion()) return zoomAt(Math.exp(dl), cx, cy)
      const c = camera()
      c.zoomBy(dl, cx, cy, pinch ? PINCH_ZOOM : NOTCH_ZOOM)
      const now = performance.now()
      const trail = pinchTrail.current
      if (!pinch) trail.length = 0
      else {
        const last = trail[trail.length - 1]
        trail.push({ t: now, l: (last?.l ?? 0) + dl })
        while (trail.length > 2 && now - trail[0].t > 100) trail.shift()
      }
      window.clearTimeout(zoomEnd.current)
      const end = (): void => {
        zoomEnd.current = 0
        pinchEnd.current = null
        // the fingers lifted: a short carry the way it was going (none in efficient mode), back inside the limits
        let carry = 0
        if (trail.length >= 2 && !lowFx()) {
          const a = trail[0]
          const b = trail[trail.length - 1]
          const span = (b.t - a.t) / 1000
          if (span > 0.02)
            carry = Math.max(-0.25, Math.min(0.25, ((b.l - a.l) / span) * PINCH_CARRY_S))
        }
        trail.length = 0
        c.release(carry)
        run()
      }
      // the end is guessed from a pause in the steps, unless the touchpad says the fingers lifted first (pinchLift)
      pinchEnd.current = pinch ? end : null
      zoomEnd.current = window.setTimeout(end, ZOOM_END_MS)
      run()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, zoomAt]
  )

  const animateTo = useCallback(
    (target: Viewport, ms = 460): void => {
      if (reducedMotion()) return set(target)
      // the glide spring, quicker for the short moves that ask for it (a zoom button) and in efficient mode
      const scale = Math.max(0.4, Math.min(1, ms / 460)) * (lowFx() ? 0.75 : 1)
      camera().glideTo(target, {
        response: SPRINGS.glide.response * scale,
        damping: SPRINGS.glide.damping
      })
      run()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, set]
  )

  /**
   * The touchpad says the fingers lifted (raw contacts, see touchpad.ts): a pinch in flight ends now, with its carry,
   * instead of after the pause in its steps that otherwise has to be waited for.
   */
  const pinchLift = useCallback((): void => {
    const end = pinchEnd.current
    if (!end) return
    window.clearTimeout(zoomEnd.current)
    end()
  }, [])

  /** Carry on moving after a drag let go, slowing down smoothly. Velocity in px per ms. */
  const fling = useCallback(
    (vx: number, vy: number, tau = 320): void => {
      camera().coast(vx * 1000, vy * 1000, tau / 1000)
      run()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run]
  )

  useEffect(() => {
    show()
    return stop
  }, [show, stop])

  return useMemo(
    () => ({
      root,
      grid,
      layer,
      get: () => view.current,
      set,
      panBy,
      zoomAt,
      wheelPan,
      wheelZoom,
      animateTo,
      fling,
      pinchLift,
      stop,
      warm
    }),
    [set, panBy, zoomAt, wheelPan, wheelZoom, animateTo, fling, pinchLift, stop, warm]
  )
}
