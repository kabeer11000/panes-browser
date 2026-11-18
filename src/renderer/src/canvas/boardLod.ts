import { useSyncExternalStore } from 'react'

/**
 * Whether the board is zoomed far out (below LOD_K), for the few parts of a card that change with it (its picture
 * takes its small copy, an answer leaves its text out). Read from here, not passed down as a prop: crossing that zoom
 * rendered every card on the board again, and now renders only those parts.
 */
let lod = false
const subs = new Set<() => void>()

export function setBoardLod(on: boolean): void {
  if (on === lod) return
  lod = on
  for (const f of subs) f()
}

const subscribe = (f: () => void): (() => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

export const useBoardLod = (): boolean => useSyncExternalStore(subscribe, () => lod)
