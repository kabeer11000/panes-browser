/**
 * A page Panes paints out of sight (a fresh picture for its board card, see TabManager.captureHidden) must not learn
 * it was shown: to Chromium it is visible for that moment, and sites take "visible" as "read" (Instagram marks the
 * open chat seen). While held, every way a page tells it is on screen says it is not:
 *
 * - `document.visibilityState` / `hidden` (and their webkit names) stay "hidden", and `visibilitychange` is not
 *   delivered;
 * - animation-frame callbacks wait (they only run for a page on screen);
 * - IntersectionObserver callbacks wait (an element "came into view").
 *
 * Whatever waited runs once the page is really shown. Focus needs nothing: a page painted out of sight never has it.
 * Not covered: a service worker asking its windows' visibility (`clients.matchAll`), which the browser answers.
 *
 * Run from its source text in the page's world (contextBridge.executeInMainWorld): everything it uses is inside it.
 * `bridge.onHold(cb)`: cb(true) as the page is about to be painted out of sight; cb(false, shown) after, `shown`
 * saying whether it is on screen now (opened meanwhile) or was hidden again.
 */
export function unseenShim(
  bridge: { onHold: (cb: (on: boolean, shown?: boolean) => void) => void },
  g: typeof globalThis = globalThis
): void {
  const D = g.Document?.prototype
  const doc = g.document
  const realState = D && Object.getOwnPropertyDescriptor(D, 'visibilityState')?.get
  if (!D || !doc || !realState) return
  const real = (): string => realState.call(doc) as string
  let masked = false // the page is told it is hidden
  let held = false // and is being painted out of sight right now
  let passing = false // our own visibilitychange, let through
  let timer: ReturnType<typeof setTimeout> | undefined

  for (const [name, value] of [
    ['visibilityState', 'hidden'],
    ['webkitVisibilityState', 'hidden'],
    ['hidden', true],
    ['webkitHidden', true]
  ] as const) {
    const get = Object.getOwnPropertyDescriptor(D, name)?.get
    if (!get) continue
    Object.defineProperty(D, name, {
      configurable: true,
      enumerable: true,
      get: {
        [name](this: Document) {
          return masked ? value : get.call(this)
        }
      }[name]
    })
  }

  // animation frames: each runs through here, and one due while masked waits for the page to be shown
  const nativeRaf = g.requestAnimationFrame?.bind(g)
  const nativeCancel = g.cancelAnimationFrame?.bind(g)
  const frames = new Map<number, { cb: FrameRequestCallback; native: number | null }>()
  const waitingFrames: number[] = []
  let seq = 0
  const run =
    (id: number) =>
    (t: number): void => {
      const f = frames.get(id)
      if (!f) return
      if (masked) {
        f.native = null
        waitingFrames.push(id)
        return
      }
      frames.delete(id)
      f.cb(t)
    }
  if (nativeRaf && nativeCancel) {
    g.requestAnimationFrame = function requestAnimationFrame(cb: FrameRequestCallback): number {
      const id = ++seq
      const f = { cb, native: null as number | null }
      frames.set(id, f)
      f.native = nativeRaf(run(id))
      return id
    }
    g.cancelAnimationFrame = function cancelAnimationFrame(id: number): void {
      const f = frames.get(id)
      if (!f) return
      frames.delete(id)
      if (f.native !== null) nativeCancel(f.native)
    }
  }

  // intersection changes seen while masked: delivered once the page is really on screen
  const waitingIo: Array<() => void> = []
  const NativeIO = g.IntersectionObserver
  if (NativeIO)
    g.IntersectionObserver = new Proxy(NativeIO, {
      construct(T, args: unknown[], newTarget) {
        const [cb, ...rest] = args
        const wrapped =
          typeof cb === 'function'
            ? function (
                this: unknown,
                entries: IntersectionObserverEntry[],
                obs: IntersectionObserver
              ): void {
                if (masked) waitingIo.push(() => cb.call(obs, entries, obs))
                else cb.call(obs, entries, obs)
              }
            : cb
        return Reflect.construct(T, [wrapped, ...rest], newTarget)
      }
    })

  const flush = (): void => {
    if (masked) return
    for (const id of waitingFrames.splice(0)) {
      const f = frames.get(id)
      if (f && nativeRaf) f.native = nativeRaf(run(id)) // runs when the page is next on screen
    }
    if (real() === 'visible') for (const deliver of waitingIo.splice(0)) deliver()
  }
  const unmask = (announce: boolean): void => {
    clearTimeout(timer)
    masked = false
    if (announce) {
      passing = true
      try {
        doc.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
      } finally {
        passing = false
      }
    }
    flush()
  }

  // first in line (capture, on window): the page's own listeners never see a change it is not told of
  g.addEventListener(
    'visibilitychange',
    (e) => {
      if (passing) return
      if (!masked) {
        setTimeout(flush, 0) // shown for real: what waited runs now
        return
      }
      e.stopImmediatePropagation()
      // hidden again after the picture: the page never knew otherwise, so it is told nothing
      if (!held && real() === 'hidden') unmask(false)
    },
    true
  )

  bridge.onHold((on, shown) => {
    clearTimeout(timer)
    if (on) {
      held = masked = true
      return
    }
    held = false
    if (!masked) return
    // opened meanwhile: it is on screen, and told so now
    if (shown) return unmask(real() === 'visible')
    if (real() === 'hidden') return unmask(false)
    // still visible to Chromium: the hiding is on its way (see the listener); if it never comes, the page is shown
    timer = setTimeout(() => unmask(real() === 'visible'), 2000)
  })
}
