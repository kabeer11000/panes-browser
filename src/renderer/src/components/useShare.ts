import { useEffect, useRef, useState } from 'react'
import type { SharePerson, ShareState } from '@shared/types'

const NOBODY: SharePerson[] = []

/** The state of one shared space, kept up to date (null while it is not shared). */
export function useShareState(spaceId: number, shared: boolean): ShareState | null {
  const [got, setGot] = useState<{ id: number; s: ShareState } | null>(null)
  useEffect(() => {
    if (!shared || !window.api.share) return
    let alive = true
    void window.api.share.state(spaceId).then((s) => {
      if (alive && s) setGot({ id: spaceId, s })
    })
    const off = window.api.share.onState((id, s) => {
      if (id === spaceId) setGot({ id, s })
    })
    return () => {
      alive = false
      off()
    }
  }, [spaceId, shared])
  return shared && got?.id === spaceId ? got.s : null
}

/**
 * A shared space's presence, for the board: who is here, and this person's pointer sent to them (at most once a
 * frame; null when it leaves the board).
 */
export function usePresence(
  spaceId: number,
  shared: boolean
): {
  people: SharePerson[]
  me: { name: string; color: string } | null
  /** The tab this person shows live in the space, if any (as main says: the board, the chips and menus agree). */
  liveTab: number | null
  point: (at: { x: number; y: number } | null) => void
} {
  const state = useShareState(spaceId, shared)
  const pending = useRef<{ x: number; y: number } | null | undefined>(undefined)
  const raf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const point = (at: { x: number; y: number } | null): void => {
    if (!shared || !window.api.share) return
    pending.current = at
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      if (pending.current !== undefined) window.api.share?.cursor(spaceId, pending.current)
      pending.current = undefined
    })
  }
  return {
    people: state?.people ?? NOBODY,
    me: state?.me ?? null,
    liveTab: state?.liveTab ?? null,
    point
  }
}
