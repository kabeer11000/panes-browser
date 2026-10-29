import { useEffect } from 'react'

const DELAY_MS = 450 // the pointer has to rest on a tab before its card opens
const QUICK_MS = 300 // moving on from one card to the next tab opens that card at once

const TAB = '.tab-row[data-tab-id], .htab[data-tab-id]'

/**
 * Hover cards for tabs, for the sidebar and the top strip alike. One listener on the document (not one per tab),
 * and nothing runs until the pointer moves onto a tab: the card is a native view the main process fills in when
 * it opens.
 */
export function useTabHover(): void {
  useEffect(() => {
    let timer: number | undefined
    let current: number | null = null
    let open = false
    let closedAt = 0

    const hide = (): void => {
      window.clearTimeout(timer)
      current = null
      if (!open) return
      open = false
      closedAt = Date.now()
      window.api.tabHover(null)
    }

    const over = (e: PointerEvent): void => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>(TAB) : null
      if (!el || e.buttons !== 0 || document.querySelector('.app.overlay-open')) return hide()
      const id = Number(el.dataset.tabId)
      if (id === current) return
      hide()
      current = id
      const show = (): void => {
        const r = el.getBoundingClientRect()
        window.api.tabHover(id, {
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
          side: el.classList.contains('htab') ? 'below' : 'right'
        })
        open = true
      }
      timer = window.setTimeout(show, Date.now() - closedAt < QUICK_MS ? 0 : DELAY_MS)
    }

    // pressing, scrolling, typing and leaving the window all end a hover
    document.addEventListener('pointerover', over)
    document.documentElement.addEventListener('pointerleave', hide)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('wheel', hide, { passive: true })
    document.addEventListener('keydown', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', over)
      document.documentElement.removeEventListener('pointerleave', hide)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('wheel', hide)
      document.removeEventListener('keydown', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])
}
