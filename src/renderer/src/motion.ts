import {
  SPRINGS,
  springAtRest,
  springCurve,
  stepSpring,
  type SpringName,
  type SpringParams
} from '@shared/spring'

/**
 * The renderer's motion kit, all on the one spring (`@shared/spring`):
 * - CSS: `--spring-<name>` is a `linear()` easing and `--spring-<name>-dur` its settle time, so a stylesheet writes
 *   `transition: scale var(--spring-snappy-dur) var(--spring-snappy)` and gets the real curve.
 * - WAAPI: `springAnimate(el, keyframes, 'bouncy')`.
 * - JS: `Spring` / `SpringVec` for values that follow input and get retargeted mid-flight (velocity carries over).
 */

const curves = new Map<string, ReturnType<typeof springCurve>>()
function curve(p: SpringParams, velocity = 0): ReturnType<typeof springCurve> {
  const key = `${p.response}|${p.damping}|${Math.round(velocity * 10)}`
  let c = curves.get(key)
  if (!c) {
    c = springCurve(p, Math.round(velocity * 10) / 10)
    curves.set(key, c)
  }
  return c
}

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Write the spring tokens on :root. Called once at startup (cheap: a few sampled curves). */
export function installSpringTokens(root: HTMLElement = document.documentElement): void {
  for (const [name, p] of Object.entries(SPRINGS)) {
    const c = curve(p)
    root.style.setProperty(`--spring-${name}`, c.easing)
    root.style.setProperty(`--spring-${name}-dur`, `${c.duration}ms`)
  }
}

/** WAAPI with a spring's own easing and settle time. `velocity` is in whole distances per second. */
export function springAnimate(
  el: Element,
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  spring: SpringName | SpringParams = 'smooth',
  opts: { delay?: number; velocity?: number; fill?: FillMode; composite?: CompositeOperation } = {}
): Animation {
  const p = typeof spring === 'string' ? SPRINGS[spring] : spring
  const c = curve(p, opts.velocity ?? 0)
  return el.animate(keyframes, {
    duration: reducedMotion() ? 1 : c.duration,
    easing: c.easing,
    delay: reducedMotion() ? 0 : (opts.delay ?? 0),
    fill: opts.fill ?? 'backwards',
    composite: opts.composite
  })
}

/** The settle time (ms) of a named spring, for timers that must wait for one. */
export const springDuration = (spring: SpringName | SpringParams): number =>
  curve(typeof spring === 'string' ? SPRINGS[spring] : spring).duration

// ---- one rAF loop for every JS spring ----
type Ticker = (dt: number) => boolean
const tickers = new Set<Ticker>()
let raf = 0
let last = 0
function loop(now: number): void {
  // a dropped frame or a background tab: never step more than 1/20 s (exact solver, but keep motion visible)
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60)
  last = now
  for (const t of [...tickers]) if (!t(dt)) tickers.delete(t)
  raf = tickers.size ? requestAnimationFrame(loop) : 0
  if (!raf) last = 0
}
function schedule(t: Ticker): void {
  tickers.add(t)
  if (!raf) raf = requestAnimationFrame(loop)
}

/** A number on a spring. `to()` retargets and keeps the velocity it has, so interruptions never jolt. */
export class Spring {
  value: number
  target: number
  velocity = 0
  private params: SpringParams
  private ticking = false
  private done: Array<() => void> = []
  constructor(
    value: number,
    spring: SpringName | SpringParams,
    private onChange: (v: number, s: Spring) => void,
    private precision = 0.01
  ) {
    this.value = this.target = value
    this.params = typeof spring === 'string' ? SPRINGS[spring] : spring
  }
  get moving(): boolean {
    return this.ticking
  }
  to(
    target: number,
    opts: { spring?: SpringName | SpringParams; velocity?: number } = {}
  ): Promise<void> {
    if (opts.spring)
      this.params = typeof opts.spring === 'string' ? SPRINGS[opts.spring] : opts.spring
    if (opts.velocity !== undefined) this.velocity = opts.velocity
    this.target = target
    if (reducedMotion()) {
      this.jump(target)
      return Promise.resolve()
    }
    const p = new Promise<void>((r) => this.done.push(r))
    if (!this.ticking) {
      this.ticking = true
      schedule(this.tick)
    }
    return p
  }
  /** Set without motion (and drop any velocity). */
  jump(v: number): void {
    this.value = this.target = v
    this.velocity = 0
    this.onChange(v, this)
    this.settle()
  }
  /** Stop where it is now, keeping no velocity. */
  stop(): void {
    this.target = this.value
    this.velocity = 0
    this.settle()
  }
  private settle(): void {
    if (this.ticking) {
      this.ticking = false
      tickers.delete(this.tick)
    }
    const d = this.done
    this.done = []
    for (const r of d) r()
  }
  private tick = (dt: number): boolean => {
    if (!this.ticking) return false
    const s = stepSpring({ x: this.value - this.target, v: this.velocity }, this.params, dt)
    if (springAtRest(s, this.precision)) {
      this.value = this.target
      this.velocity = 0
      this.onChange(this.value, this)
      this.ticking = false
      const d = this.done
      this.done = []
      for (const r of d) r()
      return false
    }
    this.value = this.target + s.x
    this.velocity = s.v
    this.onChange(this.value, this)
    return true
  }
}

/** Several numbers on one spring each, reported together once per frame. */
export class SpringVec<K extends string> {
  private springs: Record<K, Spring>
  private pending = false
  constructor(
    init: Record<K, number>,
    spring: SpringName | SpringParams,
    private onChange: (v: Record<K, number>) => void,
    precision = 0.01
  ) {
    const s = {} as Record<K, Spring>
    for (const k of Object.keys(init) as K[])
      s[k] = new Spring(init[k], spring, () => this.flush(), precision)
    this.springs = s
  }
  get value(): Record<K, number> {
    const v = {} as Record<K, number>
    for (const k of Object.keys(this.springs) as K[]) v[k] = this.springs[k].value
    return v
  }
  get velocity(): Record<K, number> {
    const v = {} as Record<K, number>
    for (const k of Object.keys(this.springs) as K[]) v[k] = this.springs[k].velocity
    return v
  }
  get moving(): boolean {
    return (Object.values(this.springs) as Spring[]).some((s) => s.moving)
  }
  to(
    target: Partial<Record<K, number>>,
    opts: { spring?: SpringName | SpringParams; velocity?: Partial<Record<K, number>> } = {}
  ): Promise<void> {
    return Promise.all(
      (Object.keys(target) as K[]).map((k) =>
        this.springs[k].to(target[k] as number, {
          spring: opts.spring,
          velocity: opts.velocity?.[k]
        })
      )
    ).then(() => undefined)
  }
  jump(v: Partial<Record<K, number>>): void {
    for (const k of Object.keys(v) as K[]) this.springs[k].jump(v[k] as number)
  }
  stop(): void {
    for (const s of Object.values(this.springs) as Spring[]) s.stop()
  }
  // one report per frame however many components moved
  private flush(): void {
    if (this.pending) return
    this.pending = true
    queueMicrotask(() => {
      this.pending = false
      this.onChange(this.value)
    })
  }
}
