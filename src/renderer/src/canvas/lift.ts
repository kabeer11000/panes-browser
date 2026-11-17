import { SPRINGS, springCurve, stepSpring, type SpringParams } from '@shared/spring'
import {
  carryVelocity,
  ShakeDetector,
  springProgress,
  tiltFor,
  VelocityTracker,
  type Pt
} from '@shared/boardPhysics'
import { reducedMotion } from '@renderer/motion'

/**
 * Things on the board in motion, on one frame loop: what the hand holds (it follows the pointer exactly, lifted a
 * little and leaning with its sideways speed), what was just let go (it settles into place carrying the speed it had,
 * its lean wobbling out), and the glides of everything else that moved (WAAPI, evaluated here from the same spring,
 * so the connectors can follow every frame without reading the page).
 *
 * Everything is written to compositor-only properties (translate, rotate, scale) of the element, beside the
 * transform React gives it; a card's transform-origin is its own centre (Cards), so it leans about its middle.
 */

type El = HTMLElement | SVGElement

/** How much bigger a held thing is (a big group less: it is already big). */
const LIFT_SCALE = 1.02
const GROUP_LIFT_SCALE = 1.01
/** A shake's flutter: how long the lean rings on the wobble spring, and its kick (deg/s). */
const JIGGLE_MS = 520
const JIGGLE_KICK = 520
/** The share of the throw's speed a dropped thing carries into its settle: enough to feel continuous, not to sail. */
const CARRY = 0.6
/** However hard the flick, a dropped thing glides past its place by no more than this (screen px). */
const CARRY_MAX_PX = 72
/** Where a let-go thing settles: a touch bouncy, so a throw lands with life (its lean rings out on `wobble`). */
const SETTLE: SpringParams = { response: 0.4, damping: 0.74 }

interface Body {
  el: El
  key: string
  /** Offset from where React puts it (board px), and its speed. */
  x: number
  y: number
  vx: number
  vy: number
  /** Lean (deg) and size, and their speeds. */
  r: number
  vr: number
  s: number
  vs: number
  tilt: boolean
  held: boolean
  /** What it leans by per degree of the hand's tilt (a big group leans less) and how big it gets held. */
  lean: number
  up: number
  /** A group turns about one point (board px), so it stays rigid; alone, a thing turns about its own middle. */
  origin: Pt | null
  /** Until when its lean rings on the wobble spring (a shake). */
  jiggle: number
}

interface Glide {
  dx: number
  dy: number
  /** performance.now() when it started, its delay, its duration and the spring's own (it may be squeezed). */
  t0: number
  delay: number
  dur: number
  natural: number
  p: SpringParams
}

const bodies = new Map<El, Body>()
const glides = new Map<string, Glide>()
const followers = new Set<(off: Map<string, Pt> | null) => void>()
const pointer = new VelocityTracker(100)
const shake = new ShakeDetector()
let zoom = 1
let raf = 0
let last = 0
/** The connectors were last told about some motion (so they are told once when it ends). */
let told = false

const lowFx = (): boolean => document.documentElement.dataset.fx === 'low'

const curves = new Map<SpringParams, ReturnType<typeof springCurve>>()
const curveOf = (p: SpringParams): ReturnType<typeof springCurve> => {
  let c = curves.get(p)
  if (!c) curves.set(p, (c = springCurve(p)))
  return c
}

function write(b: Body): void {
  const st = b.el.style
  if (!b.tilt) {
    st.translate = `${b.x}px ${b.y}px`
    return
  }
  st.rotate = `${b.r}deg`
  st.scale = String(b.s)
  if (b.origin && b.el instanceof SVGElement) {
    // a drawing keeps its origin at the board's corner (its own transform attribute turns it, about its own
    // middle): the turn about the pivot is put in the translate instead, o - RS(o)
    const a = (b.r * Math.PI) / 180
    const { x: ox, y: oy } = b.origin
    const cx = ox - b.s * (Math.cos(a) * ox - Math.sin(a) * oy)
    const cy = oy - b.s * (Math.sin(a) * ox + Math.cos(a) * oy)
    st.translate = `${b.x + cx}px ${b.y + cy}px`
    return
  }
  st.translate = `${b.x}px ${b.y}px`
  if (b.origin) st.transformOrigin = `${b.origin.x}px ${b.origin.y}px`
}

function release(b: Body): void {
  const st = b.el.style
  st.translate = ''
  st.rotate = ''
  st.scale = ''
  st.willChange = ''
  if (b.origin && !(b.el instanceof SVGElement)) st.transformOrigin = ''
  b.el.removeAttribute('data-lift')
  b.el.removeAttribute('data-up')
  bodies.delete(b.el)
  if (b.el instanceof SVGElement) {
    const layer = b.el.closest('.cv-marks')
    if (layer && ![...bodies.keys()].some((x) => x instanceof SVGElement))
      layer.removeAttribute('data-holding')
  }
}

function frame(now: number): void {
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60)
  last = now
  const v = pointer.velocity(now)
  // shaken: everything held flutters (its lean kicked, ringing on the wobble spring for a moment)
  const shaken = [...bodies.values()].some((b) => b.held) && shake.push(now, v.x)
  const off = new Map<string, Pt>()
  for (const b of bodies.values()) {
    if (b.held) {
      // the pointer places it (move), the lean and the lift follow on a quick spring
      if (b.tilt) {
        if (shaken) {
          b.jiggle = now + JIGGLE_MS
          b.vr += Math.sign(v.x || 1) * JIGGLE_KICK * b.lean
          b.vs += 0.6
        }
        const want = tiltFor(v.x) * b.lean
        const r = stepSpring(
          { x: b.r - want, v: b.vr },
          now < b.jiggle ? SPRINGS.wobble : SPRINGS.follow,
          dt
        )
        b.r = want + r.x
        b.vr = r.v
        const s = stepSpring({ x: b.s - b.up, v: b.vs }, SPRINGS.follow, dt)
        b.s = b.up + s.x
        b.vs = s.v
      }
      write(b)
      off.set(b.key, { x: b.x, y: b.y })
      continue
    }
    const sx = stepSpring({ x: b.x, v: b.vx }, SETTLE, dt)
    const sy = stepSpring({ x: b.y, v: b.vy }, SETTLE, dt)
    const sr = stepSpring({ x: b.r, v: b.vr }, SPRINGS.wobble, dt)
    const ss = stepSpring({ x: b.s - 1, v: b.vs }, SPRINGS.smooth, dt)
    b.x = sx.x
    b.vx = sx.v
    b.y = sy.x
    b.vy = sy.v
    b.r = sr.x
    b.vr = sr.v
    b.s = 1 + ss.x
    b.vs = ss.v
    const still =
      Math.hypot(b.x, b.y) < 0.1 &&
      Math.hypot(b.vx, b.vy) < 2 &&
      Math.abs(b.r) < 0.02 &&
      Math.abs(b.vr) < 0.5 &&
      Math.abs(b.s - 1) < 0.0005
    if (still) {
      release(b)
      off.set(b.key, { x: 0, y: 0 })
    } else {
      write(b)
      off.set(b.key, { x: b.x, y: b.y })
    }
  }
  for (const [key, g] of glides) {
    const t = now - g.t0 - g.delay
    if (t >= g.dur) {
      glides.delete(key)
      if (!off.has(key)) off.set(key, { x: 0, y: 0 })
      continue
    }
    const k = 1 - (t <= 0 ? 0 : springProgress(g.p, (t / g.dur) * (g.natural / 1000)))
    if (!off.has(key)) off.set(key, { x: g.dx * k, y: g.dy * k })
  }
  const busy = bodies.size > 0 || glides.size > 0
  if (busy) {
    told = true
    for (const f of followers) f(off)
    raf = requestAnimationFrame(frame)
  } else {
    raf = 0
    last = 0
    if (told) {
      told = false
      for (const f of followers) f(null)
    }
  }
}

function run(): void {
  if (!raf) {
    last = 0
    raf = requestAnimationFrame(frame)
  }
}

/** Whether this element's translate belongs to the motion here (a drag or its settle): leave it alone. */
export const owned = (el: Element): boolean => bodies.has(el as El)

/**
 * Pick these up: they lift and lean with the hand. One thing turns about its own middle; several (a section and its
 * cards, a selection) turn together about `origin`, the middle of all of them (board px), leaning less the bigger
 * they are (`size`: the diagonal of all of them). Something still settling is caught where it is.
 */
export function lift(
  items: Array<{ key: string; el: El }>,
  group: { origin: Pt; size: number } | null = null
): void {
  pointer.reset()
  shake.reset()
  const lean = !reducedMotion()
  const k = group ? Math.min(1, 520 / Math.max(1, group.size)) : 1
  for (const { key, el } of items) {
    const b: Body = bodies.get(el) ?? {
      el,
      key,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: 0,
      vr: 0,
      s: 1,
      vs: 0,
      tilt: lean,
      held: true,
      lean: k,
      up: LIFT_SCALE,
      origin: null,
      jiggle: 0
    }
    b.held = true
    b.key = key
    b.tilt = lean
    b.lean = k
    b.up = group ? GROUP_LIFT_SCALE : LIFT_SCALE
    // SVG drawings turn about the board's own coordinates; HTML about their middle (Cards' --ox/--oy) when alone
    b.origin = group ? { ...group.origin } : el instanceof SVGElement ? (b.origin ?? null) : null
    bodies.set(el, b)
    el.style.willChange = b.tilt ? 'translate, rotate, scale' : 'translate'
    // (attributes, not classes: a render of the card for its selection rewrites its className mid-drag)
    el.setAttribute('data-lift', '')
    // a held drawing: its whole layer comes over everything while it is held
    if (el instanceof SVGElement) el.closest('.cv-marks')?.setAttribute('data-holding', '')
  }
  // the shadow grows in from the next frame (a class set with `lifted` would not transition)
  requestAnimationFrame(() => {
    for (const b of bodies.values()) if (b.held) b.el.setAttribute('data-up', '')
  })
  run()
}

/** The pointer moved: what is held goes exactly with it (offset in board px), its speed read for the lean. */
export function moveHeld(
  t: number,
  clientX: number,
  clientY: number,
  dx: number,
  dy: number,
  k: number
): void {
  zoom = k
  pointer.push(t, clientX, clientY)
  for (const b of bodies.values()) {
    if (!b.held) continue
    b.x = dx
    b.y = dy
    write(b)
  }
}

/**
 * Let go: what was held settles from where it is to its place, carrying part of the pointer's speed, its lean
 * wobbling out. Its place may change right after (the drop lands in a section): `rebase` moves the offset with it.
 */
export function drop(): void {
  const p = pointer.velocity(performance.now())
  const v = carryVelocity({ x: p.x / zoom, y: p.y / zoom }, SETTLE, CARRY, CARRY_MAX_PX / zoom)
  const held = [...bodies.values()].filter((b) => b.held)
  front(held.map((b) => b.el))
  if (reducedMotion()) {
    for (const b of held) release(b)
    return
  }
  for (const b of held) {
    b.held = false
    b.vx = v.x
    b.vy = v.y
    b.el.removeAttribute('data-up')
  }
  run()
}

/** What was moved last stays on top of what it overlaps (until something else is moved). */
let fronted: Element[] = []
function front(els: El[]): void {
  for (const el of fronted) el.removeAttribute('data-front')
  fronted = []
  for (const el of els) {
    // a drawing lives in the drawings' layer: that layer comes forward
    const at = el instanceof SVGElement ? el.closest('.cv-marks') : el
    if (!at || fronted.includes(at)) continue
    at.setAttribute('data-front', '')
    fronted.push(at)
  }
}

/** Stop moving this one now, wherever it is meant to be (its own layout already put it there). */
export function letGo(el: Element): void {
  const b = bodies.get(el as El)
  if (b) release(b)
}

/** Its place (what React puts it at) moved by (dx, dy) board px: keep it where it is on screen. */
export function rebase(el: Element, dx: number, dy: number): void {
  const b = bodies.get(el as El)
  if (!b || (dx === 0 && dy === 0)) return
  b.x += dx
  b.y += dy
  // a group's pivot is on the board: it moves with the place, so the turn about it stays where it is on screen
  if (b.origin) b.origin = { x: b.origin.x - dx, y: b.origin.y - dy }
  write(b)
  run()
}

/**
 * Glide an element from (dx, dy) board px away to its place on spring `p` (WAAPI, so it runs off the main thread),
 * after `delay` ms, in `dur` ms (its own settle time by default: a staggered group squeezes the later ones so all
 * land together). Followed by the connectors under `key`.
 */
export function glide(
  el: El,
  key: string,
  dx: number,
  dy: number,
  opts: { p?: SpringParams; delay?: number; dur?: number } = {}
): void {
  const p = opts.p ?? SPRINGS.smooth
  const c = curveOf(p)
  const delay = opts.delay ?? 0
  const scale = lowFx() ? 0.8 : 1
  const dur = Math.max(80, (opts.dur ?? c.duration) * scale)
  el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], {
    duration: dur,
    easing: c.easing,
    delay,
    fill: 'backwards'
  })
  glides.set(key, { dx, dy, t0: performance.now(), delay, dur, natural: c.duration, p })
  run()
}

/** The settle time of a spring here, ms. */
export const settleMs = (p: SpringParams): number => curveOf(p).duration

/** The board's connectors follow: told every frame something moves (offsets by key), and null once all is still. */
export function onFollow(f: (off: Map<string, Pt> | null) => void): () => void {
  followers.add(f)
  return () => {
    followers.delete(f)
  }
}

/** Drop everything (the board is going away). */
export function resetLift(): void {
  for (const b of [...bodies.values()]) release(b)
  glides.clear()
  cancelAnimationFrame(raf)
  raf = 0
  last = 0
  told = false
}
