import { useEffect, useMemo, useRef, useState } from 'react'
import type { TabInfo } from '@shared/types'
import {
  badgeText,
  NO_ATTENTION,
  nudge,
  nudgeText,
  worthPeek,
  type TabAttention
} from '@shared/attention'
import { isCapturing } from '@shared/capture'
import { SiteIcon } from '@renderer/components/SiteIcon'
import { MiniPauseIcon, MiniPlayIcon } from './icons'
import type { CardModel } from './model'

/**
 * The tab strip: one row, the same on the board (its top centre) and in the preview (its header), for where you have
 * been, what plays and what is new. What plays comes first; then the recent tabs, each badged when something new
 * waits in it; a notification that comes in shows its words on its tab for a few seconds.
 */

/** How long a notification's words stay on its tab. */
export const PEEK_MS = 5000

/**
 * For each tab, the words of a notification (or call, or new count) that just came in, while they show (PEEK_MS).
 * What already waited when the strip appeared does not pop up.
 */
export function usePeeks(tabs: readonly TabInfo[]): ReadonlyMap<number, string> {
  const before = useRef<Map<number, TabAttention> | null>(null)
  const told = useRef(new Map<number, { count: number; at: number }>())
  const [peeks, setPeeks] = useState<Map<number, { text: string; at: number }>>(new Map())
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
    if (fresh.length)
      setPeeks((p) => {
        const m = new Map(p)
        for (const [id, text] of fresh) m.set(id, { text, at: now })
        return m
      })
  }, [tabs])
  useEffect(() => {
    if (peeks.size === 0) return
    const first = Math.min(...[...peeks.values()].map((p) => p.at))
    const t = window.setTimeout(
      () => {
        const now = Date.now()
        setPeeks((p) => new Map([...p].filter(([, v]) => now - v.at < PEEK_MS)))
      },
      Math.max(0, first + PEEK_MS - Date.now())
    )
    return () => window.clearTimeout(t)
  }, [peeks])
  return useMemo(() => new Map([...peeks].map(([id, v]) => [id, v.text])), [peeks])
}

/** One recent tab: its icon (badged when something new waits), its name on hover, and a notification's words. */
export function StripTab({
  m,
  on,
  peek,
  onPick
}: {
  m: CardModel
  on: boolean
  peek?: string
  onPick: (id: number) => void
}): React.JSX.Element {
  const name = `${m.title}${m.site ? ` - ${m.site}` : ''}`
  return (
    <button
      type="button"
      role="tab"
      data-rid={m.id}
      aria-selected={on}
      className={(on ? 'on' : '') + (peek ? ' peeking' : '')}
      title={peek ? `${name}: ${peek}` : name}
      onClick={() => {
        if (!on) onPick(m.id)
      }}
    >
      {m.attnNew ? (
        // something new in that tab: the same red mark as on its tab and its card
        <span className="fav-attn">
          <SiteIcon src={m.favicon} decoding="sync" />
          <b className={m.attnCount ? 'count' : ''}>{badgeText(m.attnCount ?? 0, 9)}</b>
        </span>
      ) : (
        <SiteIcon src={m.favicon} decoding="sync" />
      )}
      {/* over the strip, beside its tab, for a few seconds: never below it, where the preview's page is */}
      {peek && (
        <span className="cv-strip-peek" role="status">
          {peek}
        </span>
      )}
      <span>{m.title || m.site}</span>
    </button>
  )
}

/** What plays (or a call), first in the strip: a moving level, its name (to go to it), and play or pause. */
export function StripPlaying({
  t,
  onGo
}: {
  t: TabInfo
  onGo: (id: number) => void
}): React.JSX.Element {
  const call = isCapturing(t.capture)
  const sounding = call || (t.audible && !t.muted)
  const playing = !!(t.playing ?? t.audible)
  const title =
    t.private || t.tor ? 'Private tab' : t.aiTitle || t.title || (call ? 'Call' : 'Playing')
  return (
    <span className={'cv-strip-play' + (call ? ' call' : '')}>
      <button
        type="button"
        className="cv-strip-play-go"
        title={call ? `In a call: ${title}` : `Playing: ${title}`}
        onClick={() => onGo(t.id)}
      >
        <span className={'cv-eq' + (sounding ? '' : ' still')} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="cv-strip-play-title">{title}</span>
      </button>
      {!call && (
        <button
          type="button"
          className="cv-strip-play-btn"
          aria-label={playing ? `Pause ${title}` : `Play ${title}`}
          title={playing ? 'Pause' : 'Play'}
          onClick={() =>
            void window.api.mediaPlay?.(t.id, playing ? 'pause' : 'play').catch(() => undefined)
          }
        >
          {playing ? <MiniPauseIcon /> : <MiniPlayIcon />}
        </button>
      )}
    </span>
  )
}
