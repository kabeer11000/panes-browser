/**
 * Page views are native and paint over the window's own UI, so anything that draws UI over the page
 * (the command bar, the space editor, the site panel, a drag in progress) first asks main to swap each
 * page for its snapshot, and gives it back when done. Several of those can be open at once or hand over
 * to each other, so they share this registry: the pages are parked while anyone holds them and returned
 * only when the last one lets go. Without it, closing one (say the site panel, as you click the address
 * bar) would bring the pages back over another that is just opening (the command bar).
 */
const holders = new Map<string, boolean>() // owner -> whether a fresh snapshot is wanted
let state: Promise<void> = Promise.resolve()
let pinned = false

/**
 * Main keeps a hover-revealed sidebar or top bar out while something is open over the page (the pointer leaving
 * for the space editor must not close it). The canvas board holds the overlay for as long as it is open, so it does
 * not count: only holders other than the window's own mode ('app') pin the chrome.
 */
function sayPins(): void {
  const next = [...holders.keys()].some((k) => k !== 'app')
  if (next === pinned) return
  pinned = next
  window.api.setOverlayPins(next)
}

/** `sharp`: the pictures must match the pages exactly (an overlay that leaves most of the page in view). */
export function holdOverlay(
  owner: string,
  snapshot = true,
  sharp = owner !== 'drag'
): Promise<void> {
  const first = holders.size === 0
  holders.set(owner, snapshot)
  sayPins()
  if (first) state = window.api.setOverlay(true, snapshot, sharp)
  return state
}

export function releaseOverlay(owner: string): Promise<void> {
  if (!holders.delete(owner)) return state
  sayPins()
  if (holders.size > 0) return state
  // wait for the opening to finish, and check nobody took hold in the meantime
  state = state.then(() => (holders.size === 0 ? window.api.setOverlay(false) : undefined))
  return state
}
