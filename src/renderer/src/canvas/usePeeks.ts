import { useEffect, useRef, useState } from 'react'
import type { TabInfo } from '@shared/types'
import { NO_ATTENTION, nudge, nudgeText, worthPeek, type TabAttention } from '@shared/attention'

/** How long a notification's words stay on its tab in the strip. */
const PEEK_MS = 5000

/**
 * For each tab, the words of a notification (or call, or new count) that just came in, while they show (PEEK_MS),
 * for the tab strip (TabStrip.tsx). What already waited when the strip appeared does not pop up.
 */
export function usePeeks(tabs: readonly TabInfo[]): ReadonlyMap<number, string> {
  const before = useRef<Map<number, TabAttention> | null>(null)
  const told = useRef(new Map<number, { count: number; at: number }>())
  const [peeks, setPeeks] = useState<ReadonlyMap<number, { text: string; at: number }>>(new Map())
  useEffect(() => {
    const now = Date.now()
    const prev = before.current
    before.current = new Map(tabs.map((t) => [t.id, t.attention]))
    if (!prev) return
    const fresh: Array<[number, string]> = []
    for (const t of tabs) {
      if (t.private || t.tor) continue
      const n = nudge(prev.get(t.id) ?? NO_ATTENTION, t.attention)
      if (!n || !worthPeek(n, told.current.get(t.id), now)) continue
      told.current.set(t.id, { count: t.attention.count, at: now })
      fresh.push([t.id, nudgeText(n)])
    }
    if (fresh.length === 0) return
    // on the next turn, not inside this effect (the strip draws once more, not twice in a row). Not cancelled when
    // the tabs change again meanwhile (they do, often): what came in is already counted as seen above.
    window.setTimeout(() =>
      setPeeks((p) => {
        const m = new Map(p)
        for (const [tab, text] of fresh) m.set(tab, { text, at: now })
        return m
      })
    )
  }, [tabs])
  // each goes when its time is up
  useEffect(() => {
    if (peeks.size === 0) return
    const first = Math.min(...[...peeks.values()].map((p) => p.at))
    const id = window.setTimeout(
      () => {
        const now = Date.now()
        setPeeks((p) => new Map([...p].filter(([, v]) => now - v.at < PEEK_MS)))
      },
      Math.max(0, first + PEEK_MS - Date.now())
    )
    return () => window.clearTimeout(id)
  }, [peeks])
  return new Map([...peeks].map(([id, p]) => [id, p.text]))
}
