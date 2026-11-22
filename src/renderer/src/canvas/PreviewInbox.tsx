import { useEffect, useRef, useState } from 'react'
import type { TabInfo } from '@shared/types'
import {
  attentionLabel,
  badgeText,
  deckLine,
  deckOrder,
  messageAge,
  NO_ATTENTION,
  nudge,
  nudgeText,
  worthPeek,
  type Grouped,
  type TabAttention
} from '@shared/attention'
import { SiteIcon } from '@renderer/components/SiteIcon'
import { useDismiss } from './useDismiss'

/** How long a popup shows before it tucks back in (a ringing call stays while it rings). */
const PEEK_MS = 6000

const BellGlyph = (): React.JSX.Element => (
  <svg
    width="16"
    height="16"
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
 * Notifications from the other tabs, as a deck of message cards: the top card says who wrote and what (a call
 * ringing first, else whoever spoke last), the rest show as edges behind it with how many there are. Something new
 * lands on top with a slide and a glow. Click the deck to fan it out into the whole list; a card opens its tab.
 * The same on the board (its top-right corner) and in the preview (the header's right end), and never like the
 * recent tabs, which are tabs. Nothing waiting: the board shows nothing, the preview a quiet bell.
 */
export function PreviewInbox({
  tabs,
  open,
  onOpen,
  onClose,
  onPick,
  variant = 'bar'
}: {
  /** What waits, one entry per site or account (never private or Tor tabs). */
  tabs: Grouped<TabInfo>[]
  open: boolean
  onOpen: () => void
  onClose: () => void
  onPick: (id: number) => void
  /** In the preview's header, or floating on the board. */
  variant?: 'bar' | 'board'
}): React.JSX.Element | null {
  const wrap = useRef<HTMLDivElement>(null)
  useDismiss(open, wrap, onClose)
  // the deck's order: a ringing call, then whoever spoke last (the popup below goes through it in this order too)
  const list = deckOrder(tabs)

  // ---- the popup: what changed since the last look at the tabs ----
  const before = useRef<Map<string, TabAttention> | null>(null)
  /** When the last one landed on the deck (never cleared, so the deck remounts only for a new one). */
  const [landed, setLanded] = useState(0)
  const told = useRef(new Map<string, { count: number; at: number }>())
  const [peek, setPeek] = useState<{ key: string; text: string; call: boolean; at: number } | null>(
    null
  )
  useEffect(() => {
    const now = Date.now()
    const prev = before.current
    before.current = new Map(tabs.map((t) => [t.key, t.attention]))
    if (!prev) return // what was already waiting when the preview opened does not pop up
    for (const t of list) {
      const n = nudge(prev.get(t.key) ?? NO_ATTENTION, t.attention)
      if (!n || !worthPeek(n, told.current.get(t.key), now)) continue
      told.current.set(t.key, { count: t.attention.count, at: now })
      setPeek({ key: t.key, text: nudgeText(n), call: n.kind === 'call', at: now })
      setLanded(now)
      return
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- list is tabs, sorted
  }, [tabs])
  useEffect(() => {
    if (!peek || peek.call) return
    const t = window.setTimeout(() => setPeek(null), PEEK_MS)
    return () => window.clearTimeout(t)
  }, [peek])
  const peekTab = peek ? tabs.find((t) => t.key === peek.key) : undefined
  // gone once the tab has been looked at; a call's popup goes when it stops ringing
  const showPeek =
    peek && peekTab && !open && (!peek.call || peekTab.attention.call === 'ringing') ? peek : null

  // the ages in the list are as of opening it (it is open for moments)
  const [now, setNow] = useState(0)
  const top = list[0] ?? null
  // the top card's age, kept current while it shows
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setClock(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])
  const said = tabs.length
    ? `${tabs.length} tab${tabs.length > 1 ? 's' : ''} with something new`
    : 'Nothing new'
  const behind = Math.min(2, list.length - 1)
  const ringing = top?.attention.call === 'ringing'
  const toggle = (): void => {
    if (open) return onClose()
    setNow(Date.now())
    onOpen()
  }
  if (!top && variant === 'board') return null
  return (
    <div className={'cv-bell ' + variant} ref={wrap}>
      {top ? (
        <button
          // a new one lands on top: remounted, so it slides in again
          key={landed}
          type="button"
          className={
            'cv-deck' +
            (showPeek ? ' fresh' : '') +
            (ringing ? ' ringing' : '') +
            (open ? ' on' : '')
          }
          data-behind={behind}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Notifications: ${said}. Newest: ${nameOf(top)}, ${deckLine(top.attention)}`}
          title={`${nameOf(top)}: ${deckLine(top.attention)}`}
          onClick={toggle}
        >
          <span className="cv-deck-icon">
            {open ? <BellGlyph /> : <SiteIcon src={top.favicon} />}
          </span>
          {open ? (
            // fanned out: the list says it all below, so the deck is its heading
            <span className="cv-deck-text">
              <strong>Notifications</strong>
              <span>
                {list.length} site{list.length > 1 ? 's' : ''}
              </span>
            </span>
          ) : (
            <span className="cv-deck-text">
              <strong>{nameOf(top)}</strong>
              <span>{deckLine(top.attention)}</span>
            </span>
          )}
          {!open && top.attention.messages.length > 0 && (
            <time className="cv-deck-age">
              {messageAge(top.attention.messages.at(-1)!.at, clock)}
            </time>
          )}
          {!open && list.length > 1 && (
            <b className="cv-deck-n">+{badgeText(list.length - 1, 9)}</b>
          )}
        </button>
      ) : (
        <button
          type="button"
          className={'cv-hbtn quiet' + (open ? ' on' : '')}
          aria-label={`Notifications: ${said}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={`Notifications: ${said}`}
          onClick={toggle}
        >
          <BellGlyph />
        </button>
      )}
      {open && (
        <div className="cv-bell-menu" role="dialog" aria-label="Notifications from your tabs">
          {/* the list scrolls inside the menu, so its edges can fade while the menu keeps its shadow */}
          <div className="cv-bell-scroll">
            {list.length === 0 ? (
              <p className="cv-bell-empty">Nothing new in your other tabs.</p>
            ) : (
              list.map((t, i) => {
                const a = t.attention
                return (
                  <button
                    key={t.key}
                    type="button"
                    className="cv-bell-tab"
                    style={{ '--i': i } as React.CSSProperties}
                    title={`Open ${nameOf(t)}`}
                    onClick={() => onPick(t.id)}
                  >
                    <span className="cv-bell-row">
                      <SiteIcon src={t.favicon} />
                      <span className="cv-bell-name">{nameOf(t)}</span>
                      {/* what waits, said only when no notification says it below (a count, a call) */}
                      {(a.call || a.count > 0 || !a.messages.length) && (
                        <span className={'cv-bell-what' + (a.call === 'ringing' ? ' ringing' : '')}>
                          {attentionLabel(a)}
                        </span>
                      )}
                    </span>
                    {[...a.messages].reverse().map((msg) => (
                      <span key={msg.at + msg.title} className="cv-bell-msg">
                        <span className="cv-bell-msg-text">
                          {msg.title && <strong>{msg.title}</strong>}
                          {msg.body && <span>{msg.body}</span>}
                        </span>
                        <time>{messageAge(msg.at, now)}</time>
                      </span>
                    ))}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
