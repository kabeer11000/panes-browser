import { useEffect, useRef, useState } from 'react'
import type { TabInfo } from '@shared/types'
import {
  attentionLabel,
  messageAge,
  NO_ATTENTION,
  nudge,
  nudgeText,
  worthPeek,
  type Grouped,
  type TabAttention
} from '@shared/attention'
import { TabFavicon } from '@renderer/components/TabFavicon'
import { useDismiss } from './useDismiss'

/** How long a popup shows before it tucks back in (a ringing call stays while it rings). */
const PEEK_MS = 6000
/** Tabs shown by their icon in the bar; the rest are a "+N" (all of them are in the bell's list). */
const STRIP = 3

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
 * What the other tabs have waiting, in the preview's bar, as the board's inbox shows it: their icons always in
 * sight (badged), a popup when something sure comes in (a notification, a call ringing, a count going up), and the
 * bell for the whole list with what the notifications said. Picking a tab opens it in the preview.
 */
export function PreviewInbox({
  tabs,
  open,
  onOpen,
  onClose,
  onPick
}: {
  /** What waits, one entry per site or account (never private or Tor tabs). */
  tabs: Grouped<TabInfo>[]
  open: boolean
  onOpen: () => void
  onClose: () => void
  onPick: (id: number) => void
}): React.JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  useDismiss(open, wrap, onClose)
  // a ringing call first: it will not wait; then the most unread
  const list = [...tabs].sort(
    (a, b) =>
      +(b.attention.call === 'ringing') - +(a.attention.call === 'ringing') ||
      b.attention.count - a.attention.count
  )

  // ---- the popup: what changed since the last look at the tabs ----
  const before = useRef<Map<string, TabAttention> | null>(null)
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
  const said = tabs.length
    ? `${tabs.length} tab${tabs.length > 1 ? 's' : ''} with something new`
    : 'Nothing new'
  return (
    <div className="cv-bell" ref={wrap}>
      {showPeek && peekTab && (
        <button
          key={showPeek.at}
          type="button"
          className={'cv-bell-peek' + (showPeek.call ? ' ringing' : '')}
          role="status"
          title={`Open ${nameOf(peekTab)}`}
          onClick={() => {
            setPeek(null)
            onPick(peekTab.id)
          }}
        >
          <TabFavicon tab={peekTab} noSpinner />
          <span className="cv-bell-msg-text">
            <strong>{nameOf(peekTab)}</strong>
            <span>{showPeek.text}</span>
          </span>
        </button>
      )}
      {list.slice(0, STRIP).map((t) => (
        <button
          key={t.key}
          type="button"
          className="cv-hbtn cv-bell-fav"
          aria-label={`${nameOf(t)}, ${attentionLabel(t.attention)}`}
          title={`${nameOf(t)}: ${attentionLabel(t.attention)}`}
          onClick={() => onPick(t.id)}
        >
          <TabFavicon tab={t} noSpinner />
        </button>
      ))}
      {list.length > STRIP && <span className="cv-bell-more">+{list.length - STRIP}</span>}
      <button
        type="button"
        className={'cv-hbtn' + (open ? ' on' : '') + (tabs.length ? '' : ' quiet')}
        aria-label={`Notifications: ${said}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Notifications: ${said}`}
        onClick={() => {
          if (open) return onClose()
          setNow(Date.now())
          onOpen()
        }}
      >
        <BellGlyph />
      </button>
      {open && (
        <div className="cv-bell-menu" role="dialog" aria-label="Notifications from your tabs">
          {list.length === 0 ? (
            <p className="cv-bell-empty">Nothing new in your other tabs.</p>
          ) : (
            list.map((t) => {
              const a = t.attention
              return (
                <button
                  key={t.key}
                  type="button"
                  className="cv-bell-tab"
                  title={`Open ${nameOf(t)}`}
                  onClick={() => onPick(t.id)}
                >
                  <span className="cv-bell-row">
                    <TabFavicon tab={t} noSpinner />
                    <span className="cv-bell-name">{nameOf(t)}</span>
                    <span className={'cv-bell-what' + (a.call === 'ringing' ? ' ringing' : '')}>
                      {attentionLabel(a)}
                    </span>
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
      )}
    </div>
  )
}
