import type { WebContents } from 'electron'

/** How long a hold waits for the page's frames to confirm (a frame with no shim, or a stuck one, never does). */
const HOLD_WAIT_MS = 300

/**
 * Hold a page's frames before it is painted out of sight, or let them go after (see shared/unseen.ts). Holding
 * resolves once every web frame has it in place, so the page cannot see itself shown first. `shown`, on release:
 * whether the page is on screen now.
 */
export function holdUnseen(wc: WebContents, on: boolean, shown = false): Promise<void> {
  if (wc.isDestroyed()) return Promise.resolve()
  const frames = wc.mainFrame.framesInSubtree.filter((f) => /^https?:/i.test(f.url))
  let left = 0
  for (const f of frames) {
    try {
      f.send('unseen:hold', on, shown)
      left++
    } catch {
      // a frame going away
    }
  }
  if (!on || left === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      if (!wc.isDestroyed()) wc.ipc.off('unseen:held', heard)
      resolve()
    }
    const heard = (): void => {
      if (--left <= 0) done()
    }
    const timer = setTimeout(done, HOLD_WAIT_MS)
    wc.ipc.on('unseen:held', heard)
  })
}
