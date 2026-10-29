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

/** `sharp`: the pictures must match the pages exactly (an overlay that leaves most of the page in view). */
export function holdOverlay(
  owner: string,
  snapshot = true,
  sharp = owner !== 'drag'
): Promise<void> {
  const first = holders.size === 0
  holders.set(owner, snapshot)
  if (first) state = window.api.setOverlay(true, snapshot, sharp)
  return state
}

export function releaseOverlay(owner: string): Promise<void> {
  if (!holders.delete(owner) || holders.size > 0) return state
  // wait for the opening to finish, and check nobody took hold in the meantime
  state = state.then(() => (holders.size === 0 ? window.api.setOverlay(false) : undefined))
  return state
}
