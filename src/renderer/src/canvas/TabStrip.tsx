import { useEffect, useRef, useState } from 'react'
import { useDismiss } from './useDismiss'
import type { TabInfo } from '@shared/types'
import { attentionLabel, badgeText, messageAge, type Grouped } from '@shared/attention'
import { isCapturing } from '@shared/capture'
import { SiteIcon } from '@renderer/components/SiteIcon'
import { MiniPauseIcon, MiniPlayIcon } from './icons'
import type { CardModel } from './model'

/**
 * The tab strip: one row, the same on the board (its top centre) and in the preview (its header), for where you have
 * been, what plays and what is new. What plays comes first; then the recent tabs, each badged when something new
 * waits in it; a notification that comes in shows its words on its tab for a few seconds.
 */

/** One recent tab: its icon (badged when something new waits), its name on hover, and a notification's words. */
export function StripTab({
  m,
  on,
  peek,
  onPick,
  onHover
}: {
  m: CardModel
  on: boolean
  peek?: string
  onPick: (id: number) => void
  /** Pointed at, or left (null): the preview names it in its header instead of a tooltip over the strip. */
  onHover?: (m: CardModel | null) => void
}): React.JSX.Element {
  const name = `${m.title}${m.site ? ` - ${m.site}` : ''}`
  return (
    <button
      type="button"
      role="tab"
      data-rid={m.id}
      aria-selected={on}
      className={on ? 'on' : undefined}
      title={onHover ? undefined : peek ? `${name}: ${peek}` : name}
      aria-label={m.attnNew ? `${name}, ${m.attnCount || 'something'} new` : name}
      onPointerEnter={onHover ? () => onHover(m) : undefined}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
      onClick={() => {
        if (!on) onPick(m.id)
      }}
    >
      <SiteIcon src={m.favicon} decoding="sync" />
      {/* something new in that tab: how many, on the icon's corner as on an app in the Dock (a dot when unknown) */}
      {m.attnNew && (
        <i className={'cv-unread' + (m.attnCount ? '' : ' dot')} aria-hidden="true">
          {m.attnCount ? badgeText(m.attnCount, 9) : null}
        </i>
      )}
      <span>{m.title || m.site}</span>
    </button>
  )
}

/** What plays (or a call), first in the strip: a moving level, its name (to go to it), and play or pause. */
export function StripPlaying({
  t,
  here = false,
  onGo,
  onHover
}: {
  t: TabInfo
  /** It is the page open now: still shown (the strip never shifts), as where you are. */
  here?: boolean
  onGo: (id: number) => void
  /** Pointed at, or left: the preview names it in its header instead of a tooltip over the strip. */
  onHover?: (t: TabInfo | null) => void
}): React.JSX.Element {
  const call = isCapturing(t.capture)
  const sounding = call || (t.audible && !t.muted)
  const playing = !!(t.playing ?? t.audible)
  const title =
    t.private || t.tor ? 'Private tab' : t.aiTitle || t.title || (call ? 'Call' : 'Playing')
  return (
    <span className={'cv-strip-play' + (call ? ' call' : '') + (here ? ' here' : '')}>
      <button
        type="button"
        className="cv-strip-play-go"
        title={
          onHover
            ? undefined
            : here
              ? `Playing here: ${title}`
              : call
                ? `In a call: ${title}`
                : `Playing: ${title}`
        }
        aria-label={
          here ? `Playing here: ${title}` : call ? `In a call: ${title}` : `Playing: ${title}`
        }
        aria-current={here || undefined}
        onPointerEnter={onHover ? () => onHover(t) : undefined}
        onPointerLeave={onHover ? () => onHover(null) : undefined}
        onClick={() => {
          if (!here) onGo(t.id)
        }}
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

const BellGlyph = (): React.JSX.Element => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 6.5a4 4 0 0 1 8 0c0 3 1.2 4.2 1.5 4.5h-11C2.8 10.7 4 9.5 4 6.5ZM6.6 13a1.5 1.5 0 0 0 2.8 0" />
  </svg>
)

const nameOf = (t: TabInfo): string => t.aiTitle || t.title || 'A tab'

/**
 * The notifications, at the strip's end: a bell with how many sites have something new, opening the list as on
 * Apple's Notification Center (one rounded card per site: its icon and name, then what each notification said, newest
 * first, with its age). A card opens its tab. Always there (the strip keeps its shape): quiet when nothing waits.
 */
export function StripInbox({
  waiting,
  open,
  onOpen,
  onClose,
  onPick
}: {
  waiting: readonly Grouped<TabInfo>[]
  open: boolean
  onOpen: () => void
  onClose: () => void
  onPick: (id: number) => void
}): React.JSX.Element | null {
  // the ages are as of opening it (it is open for moments)
  const [now, setNow] = useState(0)
  // something new came in: the bell rings once (the strip itself stays still)
  const [ring, setRing] = useState(0)
  const seen = useRef(waiting.length)
  useEffect(() => {
    if (waiting.length > seen.current) setRing((r) => r + 1)
    seen.current = waiting.length
  }, [waiting.length])
  const host = useRef<HTMLSpanElement>(null)
  useDismiss(open, host, onClose)
  const said = waiting.length
    ? `${waiting.length} site${waiting.length > 1 ? 's' : ''} with something new`
    : 'nothing new'
  return (
    <span className="cv-strip-inbox" ref={host}>
      <button
        type="button"
        key={ring}
        className={'cv-strip-bell' + (open ? ' on' : '') + (ring ? ' ring' : '')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Notifications: ${said}`}
        title={`Notifications: ${said}`}
        onClick={() => {
          if (open) return onClose()
          setNow(Date.now())
          onOpen()
        }}
      >
        <BellGlyph />
        {waiting.length > 0 && <b>{badgeText(waiting.length, 9)}</b>}
      </button>
      {open && (
        <div className="cv-nc" role="dialog" aria-label="Notifications">
          <div className="cv-nc-head">Notifications</div>
          <div className="cv-nc-list">
            {waiting.length === 0 && <p className="cv-nc-empty">You are all caught up.</p>}
            {waiting.map((t, i) => {
              const a = t.attention
              const msgs = [...a.messages].reverse()
              return (
                <button
                  key={t.key}
                  type="button"
                  className="cv-nc-card"
                  style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
                  title={`Open ${nameOf(t)}`}
                  onClick={() => onPick(t.id)}
                >
                  <span className="cv-nc-app">
                    <SiteIcon src={t.favicon} />
                    <span>{nameOf(t)}</span>
                    {msgs[0] ? (
                      <time>{messageAge(msgs[0].at, now)}</time>
                    ) : (
                      <em className={a.call === 'ringing' ? 'ringing' : ''}>{attentionLabel(a)}</em>
                    )}
                  </span>
                  {msgs.slice(0, 3).map((m) => (
                    <span key={m.at + m.title} className="cv-nc-msg">
                      {m.title && <strong>{m.title}</strong>}
                      {m.body && <span>{m.body}</span>}
                    </span>
                  ))}
                  {msgs.length > 3 && <span className="cv-nc-more">{msgs.length - 3} more</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </span>
  )
}
