import { Spring } from './motion'

/**
 * How far the page area is shifted right while the hover sidebar is out, in pixels (and down while the top bar the
 * pointer brought out is). The sidebar or bar slides in by the same amount, and the main process moves the page
 * views by it too (without changing their size), so nothing is laid out again: the whole content simply moves over.
 */
let current = 0
let currentY = 0

export const getSlide = (): number => current
export const getSlideY = (): number => currentY

export function setSlide(px: number, full = 1): void {
  const v = Math.max(0, Math.round(px))
  if (v === current) return
  current = v
  document.documentElement.style.setProperty('--slide', `${v}px`)
  // how far out it is, 0 to 1: the surface and the bar's controls fade in step, so nothing pops at the ends
  document.documentElement.style.setProperty(
    '--slide-p',
    String(Math.min(1, v / Math.max(1, full)))
  )
  window.api.setSlide(v, currentY)
}

export function setSlideY(px: number, full = 1): void {
  const v = Math.max(0, Math.round(px))
  if (v === currentY) return
  currentY = v
  document.documentElement.style.setProperty('--slide-y', `${v}px`)
  document.documentElement.style.setProperty(
    '--slide-yp',
    String(Math.min(1, v / Math.max(1, full)))
  )
  window.api.setSlide(current, v)
}

// ---- on a spring: interruptible (a reversal keeps its speed), one value per frame, only transforms move ----
const springX = new Spring(0, 'smooth', (v) => setSlide(v, fullX), 0.5)
const springY = new Spring(0, 'smooth', (v) => setSlideY(v, fullY), 0.5)
let fullX = 1
let fullY = 1

/** Slide the hover sidebar (x) out to `px` or back to 0. Resolves once it rests there. */
export function slideTo(px: number, full: number): Promise<void> {
  fullX = full
  return springX.to(px, { spring: px > 0 ? 'smooth' : 'exit' })
}

/** Slide the pointer's top bar (y) out to `px` or back to 0. */
export function slideYTo(px: number, full: number): Promise<void> {
  fullY = full
  return springY.to(px, { spring: px > 0 ? 'smooth' : 'exit' })
}

export const sliding = (): boolean => springX.moving || springY.moving
