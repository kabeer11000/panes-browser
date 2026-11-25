import { useEffect } from 'react'
import { EXIT_MS } from '@renderer/components/Presence'

/**
 * Page views are native and paint over the window's own UI, so anything that draws UI over the page
 * (the command bar, the space editor, the site panel, a drag in progress) first asks main to swap each
 * page for its snapshot, and gives it back when done. Several of those can be open at once or hand over
 * to each other, so they share this registry: the pages are parked while anyone holds them and returned
 * only when the last one lets go. Without it, closing one (say the site panel, as you click the address
 * bar) would bring the pages back over another that is just opening (the command bar).
 */
const holders = new Map<string, boolean>() // owner -> whether a fresh snapshot is wanted
const later = new Map<string, number>() // owner -> a release waiting for its popover's exit (releaseOverlayLater)
let state: Promise<void> = Promise.resolve()

/** `sharp`: the pictures must match the pages exactly (an overlay that leaves most of the page in view). */
export function holdOverlay(
  owner: string,
  snapshot = true,
  sharp = owner !== 'drag'
): Promise<void> {
  // held again before a delayed release came due (a popover reopened as it left): the hold carries on
  window.clearTimeout(later.get(owner))
  later.delete(owner)
  const first = holders.size === 0
  holders.set(owner, snapshot)
  if (first) state = window.api.setOverlay(true, snapshot, sharp)
  return state
}

export function releaseOverlay(owner: string): Promise<void> {
  if (!holders.delete(owner)) return state
  if (holders.size > 0) return state
  // wait for the opening to finish, and check nobody took hold in the meantime
  state = state.then(() => (holders.size === 0 ? window.api.setOverlay(false) : undefined))
  return state
}

/**
 * Give the pages back once a popover over them has played its exit (<Presence>, EXIT_MS): given back at once, the page
 * came back over the popover as it began to leave, so it seemed to vanish instead of closing. Held again before then
 * (holdOverlay), the hold carries on.
 */
export function releaseOverlayLater(owner: string, ms = EXIT_MS): void {
  window.clearTimeout(later.get(owner))
  later.set(
    owner,
    window.setTimeout(() => {
      later.delete(owner)
      void releaseOverlay(owner)
    }, ms)
  )
}

/** Hold the pages aside while `on` (a popover or menu over the page is open); given back after its exit. */
export function useOverlayHold(owner: string, on: boolean): void {
  useEffect(() => {
    if (!on) return
    void holdOverlay(owner)
    return () => releaseOverlayLater(owner)
  }, [owner, on])
  // gone altogether (unmounted): given back now, there is nothing left to watch leave
  useEffect(
    () => () => {
      window.clearTimeout(later.get(owner))
      later.delete(owner)
      void releaseOverlay(owner)
    },
    [owner]
  )
}
