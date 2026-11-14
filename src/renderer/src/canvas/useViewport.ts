import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Viewport } from '@shared/ai/canvas'
import { boardMoved, onBoardMotion } from './boardMotion'

/**
 * The elements whose styles read the zoom in canvas.css. --vk (the zoom itself): the bars over a selection, which keep
 * their size on screen. --hs (the label scale): labels, handles and outlines, and it only changes below 62% zoom.
 * Each is set on these elements directly, so a frame of a zoom restyles a handful and not every card under the root.
 * Add a selector here when a new rule reads either property.
 */
const VK_READERS = '.cv-fbar, .cv-kbar, .cv-mbar'
const HS_READERS = [
  '.cv-badges',
  '.cv-crz',
  '.cv-frame',
  '.cv-frame-head',
  '.cv-guides',
  '.cv-handle',
  '.cv-kend',
  '.cv-nrz',
  '.cv-rz',
  '.cv-splithead'
].join(', ')

const hsOf = (k: number): string => String(Math.min(2.6, Math.max(1, 0.62 / k)))
let lastHs = '1'

/**
 * The zoom on the elements that read it (a shared style rule changed each frame cost Chromium a rebuild of its style
 * sheet each time). The root gets both too once the board settles (rootZoom), for whatever is drawn later.
 */
function zoomVars(root: HTMLElement, k: number): void {
  const vk = String(k)
  for (const el of root.querySelectorAll<HTMLElement>(VK_READERS)) el.style.setProperty('--vk', vk)
  const hs = hsOf(k)
  if (hs === lastHs) return
  lastHs = hs
  for (const el of root.querySelectorAll<HTMLElement>(HS_READERS)) el.style.setProperty('--hs', hs)
}

function rootZoom(root: HTMLElement, k: number): void {
  root.style.setProperty('--vk', String(k))
  root.style.setProperty('--hs', hsOf(k))
}

export const MIN_K = 0.08
export const MAX_K = 2.5
const clampK = (k: number): number => Math.min(MAX_K, Math.max(MIN_K, k))
const ease = (t: number): number => 1 - Math.pow(1 - t, 3)

/**
 * The board's pan and zoom. The view lives in a ref and is written straight to the DOM (one transform on the board
 * layer, the dots' position on the grid element, and the label scale on the root when the zoom changes), so a pan never
 * re-renders React. `onMove` is told after every change, throttled to one call per frame.
 */
export function useViewport(
  initial: Viewport,
  onMove: (v: Viewport) => void
): {
  root: React.RefObject<HTMLDivElement | null>
  /** The dotted background: it alone gets the per-pan properties. */
  grid: React.RefObject<HTMLDivElement | null>
  layer: React.RefObject<HTMLDivElement | null>
  get: () => Viewport
  set: (v: Viewport) => void
  panBy: (dx: number, dy: number) => void
  zoomAt: (factor: number, cx: number, cy: number) => void
  animateTo: (v: Viewport, ms?: number) => void
  /** Carry on at (vx, vy) px/ms, slowing with time constant `tau` ms (0: not at all). */
  fling: (vx: number, vy: number, tau?: number) => void
  stop: () => void
  /** Put the board on its own layer now: a movement is about to start (fingers down on the touchpad). */
  warm: () => void
} {
  const root = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const lastK = useRef(NaN)
  /** The coarse grid's tile, in screen px (the dots repeat every this far). */
  const tile = useRef(96)
  const view = useRef<Viewport>(initial)
  const raf = useRef(0)
  const anim = useRef(0)
  const moved = useRef(onMove)
  useEffect(() => {
    moved.current = onMove
  }, [onMove])
  // the board settled: the zoom goes on the root as well, once, for what is drawn later (see zoomVars)
  useEffect(
    () =>
      onBoardMotion((m) => {
        if (!m && root.current) rootZoom(root.current, view.current.k)
      }),
    []
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
      const g = grid.current
      if (v.k !== lastK.current) {
        lastK.current = v.k
        zoomVars(r, v.k)
        if (g) {
          // the fine grid keeps between 12 and 48 screen px apart (steps of 4, as the coarse grid is 4 of it), and
          // fades out as it gets dense, so the density on screen stays even and nothing pops or moires
          let ds = 24 * v.k
          while (ds < 12) ds *= 4
          while (ds >= 48) ds /= 4
          tile.current = ds * 4
          g.style.setProperty('--ds', `${ds}px`)
          g.style.setProperty('--ds2', `${ds * 4}px`)
          g.style.setProperty('--da', String(Math.min(1, Math.max(0, (ds - 10) / 14)).toFixed(3)))
        }
      }
      if (g) {
        // The dots slide as one layer, by the pan modulo one coarse tile (the grid is a tile bigger than the board on
        // each side), so a pan never repaints them: moving a painted background was a full-screen repaint a frame.
        // Whole pixels: dots that land between pixels shimmer as the board moves.
        const t = tile.current
        const ox = ((Math.round(v.x) % t) + t) % t
        const oy = ((Math.round(v.y) % t) + t) % t
        g.style.transform = `translate3d(${ox}px, ${oy}px, 0)`
      }
    }
    if (!pending.current) {
      pending.current = true
      requestAnimationFrame(() => {
        pending.current = false
        moved.current(view.current)
      })
    }
  }, [warm])

  const stop = useCallback((): void => {
    cancelAnimationFrame(anim.current)
    cancelAnimationFrame(raf.current)
  }, [])

  const set = useCallback(
    (v: Viewport): void => {
      view.current = { x: v.x, y: v.y, k: clampK(v.k) }
      paint()
    },
    [paint]
  )

  const panBy = useCallback(
    (dx: number, dy: number): void =>
      set({ ...view.current, x: view.current.x + dx, y: view.current.y + dy }),
    [set]
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

  const animateTo = useCallback(
    (target: Viewport, ms = 360): void => {
      stop()
      const from = { ...view.current }
      const to = { ...target, k: clampK(target.k) }
      const t0 = performance.now()
      const step = (now: number): void => {
        const t = Math.min(1, (now - t0) / ms)
        const e = ease(t)
        // zoom along a log scale so a big zoom feels even
        const k = from.k * Math.pow(to.k / from.k, e)
        set({ k, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e })
        if (t < 1) anim.current = requestAnimationFrame(step)
      }
      anim.current = requestAnimationFrame(step)
    },
    [set, stop]
  )

  /** Carry on moving after a drag let go, slowing down smoothly. Velocity in px per ms. */
  const fling = useCallback(
    (vx: number, vy: number, tau = 320): void => {
      stop()
      if (tau <= 0 || Math.hypot(vx, vy) < 0.08) return
      let last = performance.now()
      let x = vx
      let y = vy
      const step = (now: number): void => {
        const dt = Math.min(48, now - last)
        last = now
        const decay = Math.exp(-dt / tau)
        x *= decay
        y *= decay
        panBy(x * dt, y * dt)
        if (Math.hypot(x, y) > 0.02) raf.current = requestAnimationFrame(step)
      }
      raf.current = requestAnimationFrame(step)
    },
    [panBy, stop]
  )

  useEffect(() => {
    paint()
    return stop
  }, [paint, stop])

  return useMemo(
    () => ({
      root,
      grid,
      layer,
      get: () => view.current,
      set,
      panBy,
      zoomAt,
      animateTo,
      fling,
      stop,
      warm
    }),
    [set, panBy, zoomAt, animateTo, fling, stop, warm]
  )
}
