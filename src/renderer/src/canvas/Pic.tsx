import { useEffect, useReducer, useState } from 'react'
import { bad, full, prepare, small } from './pics'
import { useBoardLod } from './boardLod'

/**
 * A card's picture: the decoded picture, or its small copy when `low` (the board zoomed far out) or until the picture
 * is decoded, or `fallback` until either is ready (or when it will not load). Fades in only the first time it shows.
 */
export function Pic({
  src,
  low: lowProp,
  fallback = null
}: {
  src: string
  /** The small copy is enough; by default, whenever the board is zoomed far out. */
  low?: boolean
  fallback?: React.ReactNode
}): React.JSX.Element | null {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const boardLow = useBoardLod()
  const low = lowProp ?? boardLow
  const fullOk = full.has(src)
  const smallUrl = small.peek(src)
  // a new picture of the same card (the page changed) replaces the old one once it is decoded, not before
  // A card already showing its picture keeps it as the board zooms far out: swapping every card on screen to its small
  // copy the moment the board settled was a new picture for the graphics card to take in for each of them at once (a
  // stall of a third of a second). Only cards that come into view zoomed out start with the small copy.
  const pick = (keep: string | null): string | null =>
    bad.has(src)
      ? null
      : low
        ? keep === src
          ? src
          : (smallUrl ?? (fullOk ? src : null))
        : fullOk
          ? src
          : (smallUrl ?? null)
  const [last, setLast] = useState<string | null>(() => pick(null))
  const ready = pick(last)
  if (ready && ready !== last) setLast(ready)
  const shown = ready ?? (bad.has(src) ? null : last)
  // shown from the first frame: no fade. Waited for: a short fade, so it does not pop
  const [fade] = useState(shown === null)
  useEffect(() => {
    if (bad.has(src)) return
    // keep it at the front of what is kept while a card shows it
    if (low) small.get(src)
    else full.get(src)
    if (low ? small.has(src) : full.has(src)) return
    let dead = false
    void prepare(src).then(() => {
      if (!dead) bump()
    })
    return () => {
      dead = true
    }
  }, [src, low])
  if (!shown) return <>{fallback}</>
  return (
    <img
      src={shown}
      alt=""
      decoding="sync"
      draggable={false}
      className={fade ? 'cv-pic-in' : undefined}
    />
  )
}
