import { splitShortcut } from '@shared/tooltipText'
import './tooltip.css'

/**
 * Panes' own tooltips, in place of the system's grey boxes, for every `title` in a window: a small dark label that
 * springs up from the thing hovered, with a trailing "(Ctrl+K)"-style shortcut drawn as keys. The first one waits a
 * beat; moving along a row of buttons then shows each at once, the label gliding from one to the next.
 *
 * A hovered element's `title` moves to `data-tip` (so the system tooltip never shows) and to `aria-description` (so
 * screen readers keep it). Install once per window: `installTooltips()`.
 */

const SHOW_DELAY = 480
/** Within this long of a tip closing, the next shows at once (sliding along a toolbar). */
const WARM_MS = 450
const GAP = 8
const EDGE = 8

let tip: HTMLDivElement | null = null
let label: HTMLSpanElement | null = null
let keys: HTMLSpanElement | null = null
let target: Element | null = null
let timer = 0
let lastHidden = 0
let shown = false
let watch: MutationObserver | null = null

function ensure(): void {
  if (tip) return
  tip = document.createElement('div')
  tip.className = 'px-tip'
  tip.setAttribute('role', 'tooltip')
  tip.setAttribute('aria-hidden', 'true')
  label = document.createElement('span')
  keys = document.createElement('span')
  keys.className = 'px-tip-keys'
  tip.append(label, keys)
  document.body.append(tip)
}

function adopt(el: Element): string | null {
  const t = el.getAttribute('title')
  if (t !== null) {
    el.removeAttribute('title')
    if (t.trim()) {
      el.setAttribute('data-tip', t)
      if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-description'))
        el.setAttribute('aria-description', t)
    } else el.removeAttribute('data-tip')
  }
  return el.getAttribute('data-tip')
}

function tipOf(start: EventTarget | null): Element | null {
  if (!(start instanceof Element)) return null
  const el = start.closest('[title], [data-tip]')
  if (!el || el.closest('[data-no-tip]')) return null
  return el
}

function place(el: Element): boolean {
  if (!tip) return false
  const r = el.getBoundingClientRect()
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  // a control slid out of sight (a hidden sidebar, a scrolled list): no label floating over nothing
  if (r.width === 0 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false
  // a native view (a web page) is drawn over this whole document: a label there is never seen
  const pages = [...document.querySelectorAll('[data-native-view]')].map((n) =>
    n.getBoundingClientRect()
  )
  // never wider than the window allows (a small popover window gets a wrapped label, never a cut one), nor than the
  // strip beside a page the control sits in (the sidebar next to the page: wrapped there, never under the page)
  let span = vw - 2 * EDGE
  for (const b of pages) {
    if (r.top >= b.bottom || r.bottom <= b.top) continue
    if (r.right <= b.left) span = Math.min(span, b.left - 2 * EDGE)
    else if (r.left >= b.right) span = Math.min(span, vw - b.right - 2 * EDGE)
  }
  tip.style.maxWidth = `${Math.max(80, Math.min(320, span))}px`
  const w = tip.offsetWidth
  const h = tip.offsetHeight
  const room = { above: r.top - GAP - EDGE, below: vh - r.bottom - GAP - EDGE }
  // above by default (bars sit at the bottom); below when it fits better or the element asks for it
  const wantBelow = el.closest('[data-tip-below]') !== null
  const below = wantBelow
    ? room.below >= h || room.below >= room.above
    : room.above < h && room.below > room.above
  const clampY = (y: number): number => Math.max(EDGE, Math.min(vh - EDGE - h, y))
  // centred on the visible part of the control, held inside the window
  const cx = (Math.max(r.left, 0) + Math.min(r.right, vw)) / 2
  const clampX = (x: number): number => Math.max(EDGE, Math.min(vw - EDGE - w, x))
  // Try the preferred side, then the other, each slid sideways off any page if it can be; the first that is clear
  // wins; then beside it (right, then left), in its own bar. A label is never on the control itself (held inside the
  // window, one near an edge used to be pushed onto it) nor on a page; with nowhere like that, no label.
  const hits = (x: number, y: number): DOMRect | undefined =>
    pages.find((b) => x < b.right && x + w > b.left && y < b.bottom && y + h > b.top)
  const clear = (y: number): { x: number; y: number } | null => {
    let x = clampX(cx - w / 2)
    const b = hits(x, y)
    if (b)
      x =
        b.left - EDGE - w >= EDGE
          ? Math.min(x, b.left - EDGE - w)
          : clampX(Math.max(x, b.right + EDGE))
    return onControl(x, y) || hits(x, y) ? null : { x, y }
  }
  const onControl = (x: number, y: number): boolean =>
    x < r.right && x + w > r.left && y < r.bottom && y + h > r.top
  /** Beside the control, centred on it: right or left, inside the window. */
  const beside = (right: boolean): { x: number; y: number } | null => {
    const x = right ? r.right + GAP : r.left - GAP - w
    const y = clampY(r.top + r.height / 2 - h / 2)
    if (x < EDGE || x + w > vw - EDGE) return null
    return onControl(x, y) || hits(x, y) ? null : { x, y }
  }
  const sides = [below, !below]
  const tries = sides.map((b) => ({ below: b, y: clampY(b ? r.bottom + GAP : r.top - GAP - h) }))
  let spot: { below: boolean; x: number; y: number } | null = null
  for (const t of tries) {
    const c = clear(t.y)
    if (c) {
      spot = { below: t.below, ...c }
      break
    }
  }
  for (const right of [true, false]) {
    if (spot) break
    const c = beside(right)
    // the lift comes from the control's side: below reads as "from above", fine for a label at the side too
    if (c) spot = { below: true, ...c }
  }
  if (!spot) return false
  const { x, y } = spot
  const isBelow = spot.below
  tip.style.setProperty('--x', `${Math.round(x)}px`)
  tip.style.setProperty('--y', `${Math.round(y)}px`)
  tip.style.setProperty('--from', isBelow ? '-4px' : '4px')
  // the little lift starts from the control's side of the label, under the control even when the label is pushed in
  const ox = Math.max(8, Math.min(w - 8, cx - x))
  tip.style.transformOrigin = `${Math.round(ox)}px ${isBelow ? '0' : '100%'}`
  return true
}

function show(el: Element): void {
  const text = el.getAttribute('data-tip')
  if (!text || !el.isConnected) return
  ensure()
  const parts = splitShortcut(text)
  label!.textContent = parts.text
  keys!.replaceChildren(
    ...parts.keys.map((k) => {
      const kbd = document.createElement('kbd')
      kbd.textContent = k
      return kbd
    })
  )
  keys!.hidden = parts.keys.length === 0
  // gliding from the last one: keep the position transition; a fresh one appears in place
  const gliding = shown
  tip!.classList.toggle('glide', gliding)
  if (!gliding) tip!.classList.remove('on')
  if (!place(el)) {
    tip!.classList.remove('on', 'glide')
    shown = false
    return
  }
  if (!gliding) {
    void tip!.offsetWidth // the start state, then the spring in
  }
  tip!.classList.add('on')
  shown = true
}

function hide(): void {
  window.clearTimeout(timer)
  timer = 0
  watch?.disconnect()
  watch = null
  if (shown) lastHidden = performance.now()
  shown = false
  target = null
  tip?.classList.remove('on', 'glide')
}

function enter(el: Element): void {
  if (el === target) return
  const wasShown = shown
  target = el
  adopt(el)
  window.clearTimeout(timer)
  // React may put the title back when it changes: take it again, and update a tip that is up
  watch?.disconnect()
  watch = new MutationObserver(() => {
    if (el.hasAttribute('title')) {
      adopt(el)
      if (shown && target === el) show(el)
    }
  })
  watch.observe(el, { attributes: true, attributeFilter: ['title'] })
  const warm = wasShown || performance.now() - lastHidden < WARM_MS
  if (warm) show(el)
  else timer = window.setTimeout(() => target === el && show(el), SHOW_DELAY)
}

export function installTooltips(): void {
  if ((window as { __pxTips?: boolean }).__pxTips) return
  ;(window as { __pxTips?: boolean }).__pxTips = true
  document.addEventListener(
    'pointerover',
    (e) => {
      if (e.pointerType === 'touch') return
      const el = tipOf(e.target)
      if (el) enter(el)
      else if (target) hide()
    },
    true
  )
  document.addEventListener(
    'pointerout',
    (e) => {
      if (!target) return
      const to = e.relatedTarget
      if (to instanceof Node && target.contains(to)) return
      if (tipOf(to) === null) hide()
    },
    true
  )
  // anything you do with the thing makes its label go
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'scroll', 'blur', 'dragstart'] as const)
    window.addEventListener(ev, () => target && hide(), true)
  // keyboard users get the label when a control takes the focus by keyboard
  document.addEventListener(
    'focusin',
    (e) => {
      const el = tipOf(e.target)
      if (el && el instanceof HTMLElement && el.matches(':focus-visible')) {
        target = null
        enter(el)
      }
    },
    true
  )
  document.addEventListener('focusout', () => target && hide(), true)
}
