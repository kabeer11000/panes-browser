import { useSyncExternalStore } from 'react'

/**
 * Whose live tab this person is watching, if anyone's (one at a time): the board's Watch chips, a live tab's card
 * and the window's chip all open the same viewer (LiveShare.tsx).
 */
export type Watching = { spaceId: number; personId: number } | null

let now: Watching = null
const subs = new Set<() => void>()

export function watchLive(w: Watching): void {
  now = w
  for (const f of subs) f()
}

export const useWatching = (): Watching =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => now
  )
