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
