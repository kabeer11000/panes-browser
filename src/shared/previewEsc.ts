/**
 * Esc in the board's preview closes it only when the page did not use the key itself: a site's own menu, dialog,
 * search box or player that takes Esc keeps it. Put into the page shown live in the preview; it only listens.
 *
 * The page's listeners run first or later depending on when they were added, so the check waits until the key has
 * gone through all of them (a task later), then looks whether any claimed it (preventDefault). An open <dialog> or
 * popover, or anything in fullscreen, is the browser's own use of Esc: those count as claimed too.
 */
export const ESC_PREFIX = '__panes_esc__'

export const ESC_SCRIPT = `(() => {
  const k = Symbol.for('panes.previewEsc')
  if (window[k]) return
  window[k] = true
  const say = console.debug.bind(console)
  const open = () => {
    try {
      return !!document.querySelector('dialog[open], :popover-open')
    } catch {
      return !!document.querySelector('dialog[open]')
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing || e.repeat || document.fullscreenElement || open()) return
    setTimeout(() => {
      if (!e.defaultPrevented) say('${ESC_PREFIX}')
    }, 0)
  })
})()`

/** Whether a page's console message is the unclaimed-Esc report. */
export function isPreviewEsc(message: string): boolean {
  return message === ESC_PREFIX
}
