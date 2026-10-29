/**
 * How far the page area is shifted right while the hover sidebar is out, in pixels. The sidebar slides in
 * from the left by the same amount, and the main process moves the page views by it too (without changing
 * their size), so nothing is laid out again: the whole content simply moves over.
 */
let current = 0

export const getSlide = (): number => current

export function setSlide(px: number): void {
  const v = Math.max(0, Math.round(px))
  if (v === current) return
  current = v
  document.documentElement.style.setProperty('--slide', `${v}px`)
  window.api.setSlide(v)
}
