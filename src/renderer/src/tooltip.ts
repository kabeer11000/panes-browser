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
  // never wider than the window allows (a small popover window gets a wrapped label, never a cut one)
  tip.style.maxWidth = `${Math.max(80, Math.min(320, vw - 2 * EDGE))}px`
  const w = tip.offsetWidth
  const h = tip.offsetHeight
  const room = { above: r.top - GAP - EDGE, below: vh - r.bottom - GAP - EDGE }
  // above by default (bars sit at the bottom); below when it fits better or the element asks for it
  const wantBelow = el.closest('[data-tip-below]') !== null
  const below = wantBelow
    ? room.below >= h || room.below >= room.above
    : room.above < h && room.below > room.above
  let y = below ? r.bottom + GAP : r.top - GAP - h
  // neither side has room (a tiny window): keep it inside, over the edge of the control rather than cut off
  y = Math.max(EDGE, Math.min(vh - EDGE - h, y))
  // centred on the visible part of the control, held inside the window
  const cx = (Math.max(r.left, 0) + Math.min(r.right, vw)) / 2
  const x = Math.max(EDGE, Math.min(vw - EDGE - w, cx - w / 2))
  tip.style.setProperty('--x', `${Math.round(x)}px`)
  tip.style.setProperty('--y', `${Math.round(y)}px`)
  tip.style.setProperty('--from', below ? '-4px' : '4px')
  // the little lift starts from the control's side of the label, under the control even when the label is pushed in
  const ox = Math.max(8, Math.min(w - 8, cx - x))
  tip.style.transformOrigin = `${Math.round(ox)}px ${below ? '0' : '100%'}`
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
