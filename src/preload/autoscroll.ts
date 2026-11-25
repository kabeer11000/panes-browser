import { autoscrollSpeed, DEAD_ZONE, endsOnRelease } from '@shared/autoscroll'

/** Whether `el` scrolls along an axis by itself (it has more than it shows, and its overflow lets it). */
function scrolls(el: Element, axis: 'x' | 'y'): boolean {
  const s = getComputedStyle(el)
  const overflow = axis === 'y' ? s.overflowY : s.overflowX
  const more = axis === 'y' ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth
  return more && (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay')
}

/** What a press at `t` scrolls: the nearest box that scrolls, else the page, else nothing. */
function scrollerAt(t: Element | null): Element | null {
  const root = document.documentElement
  for (let el = t; el && el !== root && el !== document.body; el = el.parentElement)
    if (scrolls(el, 'y') || scrolls(el, 'x')) return el
  const page = document.scrollingElement
  if (!page) return null
  const hidden = (el: Element | null): boolean => !!el && getComputedStyle(el).overflow === 'hidden'
  const more = page.scrollHeight > innerHeight + 1 || page.scrollWidth > innerWidth + 1
  return more && !hidden(root) && !hidden(document.body) ? page : null
}

/** Where a press on the wheel is the page's own: a link opens in a new tab, a field may paste. */
const PAGE_OWN =
  'a[href], area[href], input, textarea, select, [contenteditable]:not([contenteditable="false"])'

/** The mark at the starting point, out of the page's styles' reach (a closed shadow root). */
function overlay(x: number, y: number): HTMLElement {
  const host = document.createElement('div')
  host.style.cssText =
    'all:initial;position:fixed;inset:0;z-index:2147483647;cursor:all-scroll;background:transparent'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `<style>
  i { position: fixed; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%;
      background: rgb(255 255 255 / 0.92); box-shadow: 0 0 0 1px rgb(0 0 0 / 0.25), 0 2px 8px rgb(0 0 0 / 0.25);
      display: grid; place-items: center; }
  svg { width: 20px; height: 20px; fill: #333; }
</style><i style="left:${x}px;top:${y}px"><svg viewBox="0 0 20 20" aria-hidden="true">
  <path d="M10 2 13 6H7zM10 18l3-4H7zM2 10l4-3v6zM18 10l-4-3v6z"/><circle cx="10" cy="10" r="1.6"/></svg></i>`
  return host
}

/**
 * Middle-click autoscroll (Chrome on Windows): press the wheel where nothing else takes it (not a link or a field, and
 * the page did not handle the press itself), then move: what is under the press scrolls toward the pointer. Held and
 * moved, letting go ends it; a quick click keeps it on until the next click, key or wheel.
 */
export function installAutoscroll(): void {
  let on = false
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 1 || e.defaultPrevented || on) return
    const target = e.composedPath()[0]
    const el = target instanceof Element ? target : null
    if (el?.closest(PAGE_OWN)) return
    const box = scrollerAt(el)
    if (!box) return
    e.preventDefault()
    start(box, e)
  })

  function start(box: Element, e: MouseEvent): void {
    on = true
    const ox = e.clientX
    const oy = e.clientY
    let px = ox
    let py = oy
    let moved = false
    const t0 = performance.now()
    let last = t0
    // fractions of a pixel kept, so a slow scroll still moves
    let carryX = 0
    let carryY = 0
    const mark = overlay(ox, oy)
    document.documentElement.appendChild(mark)
    let frame = requestAnimationFrame(function tick(now) {
      const dt = Math.min(now - last, 50) / 1000
      last = now
      carryX += autoscrollSpeed(px - ox) * dt
      carryY += autoscrollSpeed(py - oy) * dt
      const sx = Math.trunc(carryX)
      const sy = Math.trunc(carryY)
      carryX -= sx
      carryY -= sy
      if (sx || sy) box.scrollBy({ left: sx, top: sy, behavior: 'instant' })
      frame = requestAnimationFrame(tick)
    })
    const swallow = (ev: Event): void => {
      ev.preventDefault()
      ev.stopImmediatePropagation()
    }
    const move = (ev: MouseEvent): void => {
      px = ev.clientX
      py = ev.clientY
      if (Math.hypot(px - ox, py - oy) > DEAD_ZONE) moved = true
    }
    /** The click (and menu) that follow the press that ended it are the stop's too. */
    const swallowNext = (): void => {
      const once = (x: Event): void => swallow(x)
      for (const t of ['click', 'auxclick', 'contextmenu'])
        window.addEventListener(t, once, { capture: true, once: true })
      setTimeout(() => {
        for (const t of ['click', 'auxclick', 'contextmenu'])
          window.removeEventListener(t, once, { capture: true })
      }, 500)
    }
    const down = (ev: MouseEvent): void => {
      swallow(ev) // the click that ends it does nothing else, as in Chrome
      stop()
      swallowNext()
    }
    const up = (ev: MouseEvent): void => {
      if (ev.button !== 1) return
      swallow(ev)
      if (!endsOnRelease(performance.now() - t0, moved)) return
      stop()
      swallowNext()
    }
    const key = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') swallow(ev)
      stop()
    }
    const away = (): void => stop()
    const opts = { capture: true }
    window.addEventListener('mousemove', move, opts)
    window.addEventListener('mousedown', down, opts)
    window.addEventListener('mouseup', up, opts)
    window.addEventListener('auxclick', swallow, opts)
    window.addEventListener('keydown', key, opts)
    window.addEventListener('wheel', away, opts)
    window.addEventListener('blur', away)
    document.addEventListener('visibilitychange', away)
    function stop(): void {
      if (!on) return
      on = false
      cancelAnimationFrame(frame)
      mark.remove()
      window.removeEventListener('mousemove', move, opts)
      window.removeEventListener('mousedown', down, opts)
      window.removeEventListener('mouseup', up, opts)
      window.removeEventListener('auxclick', swallow, opts)
      window.removeEventListener('keydown', key, opts)
      window.removeEventListener('wheel', away, opts)
      window.removeEventListener('blur', away)
      document.removeEventListener('visibilitychange', away)
    }
  }
}
