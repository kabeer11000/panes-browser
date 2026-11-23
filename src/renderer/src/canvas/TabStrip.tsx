import { useCallback, useEffect, useRef, useState } from 'react'
import { useDismiss } from './useDismiss'
import type { PlayingTab, Space, TabInfo } from '@shared/types'
import { attentionLabel, badgeText, messageAge, type Grouped } from '@shared/attention'
import { isCapturing } from '@shared/capture'
import { SiteIcon } from '@renderer/components/SiteIcon'
import { MiniPauseIcon, MiniPlayIcon } from './icons'
import {
  CameraIcon,
  CloseIcon,
  MicIcon,
  MicOffIcon,
  ScreenIcon,
  SpeakerIcon
} from '@renderer/components/icons'
import { SpaceAvatar } from '@renderer/components/SpaceAvatar'
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
  onHover,
  onDragStart
}: {
  m: CardModel
  on: boolean
  peek?: string
  onPick: (id: number) => void
  /** Pointed at, or left (null): the preview names it in its header instead of a tooltip over the strip. */
  onHover?: (m: CardModel | null) => void
  /** A press that may become a drag (the preview: onto the page, to open it beside); a plain click still picks. */
  onDragStart?: (e: React.PointerEvent) => void
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
      // with a drag start, the press is the drag's: a click without moving comes back through it as a pick
      onPointerDown={onDragStart}
      onClick={
        onDragStart
          ? undefined
          : () => {
              if (!on) onPick(m.id)
            }
      }
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

/** What the playing pill and the island need of a tab: a tab of this space, or one of any space (PlayingTab). */
type Playable = Pick<
  TabInfo,
  | 'id'
  | 'url'
  | 'favicon'
  | 'title'
  | 'aiTitle'
  | 'private'
  | 'tor'
  | 'capture'
  | 'audible'
  | 'muted'
  | 'playing'
>

const playingTitle = (t: Playable): string =>
  t.private || t.tor
    ? 'Private tab'
    : t.aiTitle || t.title || (isCapturing(t.capture) ? 'Call' : 'Playing')

/**
 * Whether it plays, and play or pause. What the page said after a click holds until the tab's own state catches up
 * (it is asked of the page, a moment later): without it the button showed the old state for a beat, and a second
 * click undid the first.
 */
function usePlayToggle(t: Playable): [boolean, () => void] {
  const [said, setSaid] = useState<{ paused: boolean; n: number } | null>(null)
  const clicks = useRef(0)
  const playing = said ? !said.paused : !!(t.playing ?? t.audible)
  const toggle = (): void =>
    void window.api
      .mediaPlay?.(t.id, playing ? 'pause' : 'play')
      .then((r) => {
        if (!r) return
        const n = ++clicks.current
        setSaid({ paused: r.paused, n })
        window.setTimeout(() => setSaid((x) => (x?.n === n ? null : x)), 3000)
      })
      .catch(() => undefined)
  return [playing, toggle]
}

/** What plays (or a call), first in the strip: a moving level, its name (to go to it), play or pause, and mute. */
export function StripPlaying({
  t,
  here = false,
  onGo,
  onHover
}: {
  t: Playable
  /** It is the page open now: still shown (the strip never shifts), as where you are. */
  here?: boolean
  onGo: (id: number) => void
  /** Pointed at, or left: the preview names it in its header instead of a tooltip over the strip. */
  onHover?: (t: Playable | null) => void
}): React.JSX.Element {
  const call = isCapturing(t.capture)
  const c = t.capture
  const sounding = t.audible && !t.muted
  const callState = [
    c.mic ? (c.micMuted ? 'mic muted' : 'mic on') : '',
    c.camera ? 'camera on' : '',
    c.screen ? 'sharing screen' : ''
  ]
    .filter(Boolean)
    .join(', ')
  const [playing, toggle] = usePlayToggle(t)
  const title = playingTitle(t)
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
                ? `In a call: ${title} (${callState})`
                : `Playing: ${title}`
        }
        aria-label={
          here
            ? `Playing here: ${title}`
            : call
              ? `In a call: ${title}, ${callState}`
              : `Playing: ${title}`
        }
        aria-current={here || undefined}
        onPointerEnter={onHover ? () => onHover(t) : undefined}
        onPointerLeave={onHover ? () => onHover(null) : undefined}
        onClick={() => {
          if (!here) onGo(t.id)
        }}
      >
        {call ? (
          // what the call holds, as the page has it: a muted mic shows struck through
          <span className="cv-strip-call" aria-hidden="true">
            {c.mic && (
              <span className={c.micMuted ? 'off' : 'on'}>
                {c.micMuted ? <MicOffIcon /> : <MicIcon />}
              </span>
            )}
            {c.camera && (
              <span className="on">
                <CameraIcon />
              </span>
            )}
            {c.screen && (
              <span className="on">
                <ScreenIcon />
              </span>
            )}
          </span>
        ) : (
          <span className={'cv-eq' + (sounding ? '' : ' still')} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        <span className="cv-strip-play-title">{title}</span>
      </button>
      <PlayControls t={t} title={title} call={call} playing={playing} toggle={toggle} />
    </span>
  )
}

/** Play or pause (not for a call: it has no media to pause) and mute, for one tab: the pill's and each list row's. */
function PlayControls({
  t,
  title,
  call,
  playing,
  toggle
}: {
  t: Playable
  title: string
  call: boolean
  playing: boolean
  toggle: () => void
}): React.JSX.Element {
  return (
    <>
      {!call && (
        <button
          type="button"
          className="cv-strip-play-btn"
          aria-label={playing ? `Pause ${title}` : `Play ${title}`}
          title={playing ? 'Pause' : 'Play'}
          onClick={toggle}
        >
          {playing ? <MiniPauseIcon /> : <MiniPlayIcon />}
        </button>
      )}
      <button
        type="button"
        className="cv-strip-play-btn"
        aria-label={t.muted ? `Unmute ${title}` : `Mute ${title}`}
        title={t.muted ? 'Unmute' : 'Mute'}
        onClick={() => window.api.toggleMute(t.id)}
      >
        <SpeakerIcon muted={t.muted} />
      </button>
    </>
  )
}

/**
 * Now playing, every space (the island): today's playing pill for the first of them, and with more than one a +N that
 * opens the list of them all under it: calls, what is heard, what is paused (shared/nowPlaying.ts), each with its
 * space when it is not this one, play or pause, mute, and a paused one can be taken off the list. A name takes you
 * to the tab, switching space if it is in another (main's show). The same on the board, in its preview's header and
 * in the tab view's top bar; `onList` tells the host the list is open, so it can put the page out of its way.
 */
export function NowPlaying({
  items,
  spaces,
  activeSpaceId,
  here = null,
  onGo,
  onHover,
  onList
}: {
  items: readonly PlayingTab[]
  spaces: readonly Space[]
  activeSpaceId: number
  /** The tab on screen now (the preview's page, the tab view's tab): shown as where you are. */
  here?: number | null
  /** Go to a tab; by default main's show (its space first, then the tab, on the board in the preview). */
  onGo?: (t: PlayingTab) => void
  onHover?: (t: Playable | null) => void
  onList?: (open: boolean) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLSpanElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, host, close)
  const shown = open && items.length > 1
  const onListRef = useRef(onList)
  useEffect(() => {
    onListRef.current = onList
  })
  useEffect(() => {
    onListRef.current?.(shown)
  }, [shown])
  useEffect(() => () => onListRef.current?.(false), [])
  const top = items[0]
  if (!top) return null
  const go = (t: PlayingTab): void => {
    setOpen(false)
    if (onGo) onGo(t)
    else window.api.activateTab(t.id)
  }
  const spaceOf = (id: number): Space | undefined =>
    id === activeSpaceId ? undefined : spaces.find((s) => s.id === id)
  const topSpace = spaceOf(top.spaceId)
  return (
    <span className={'cv-island' + (shown ? ' open' : '')} ref={host}>
      <span className="cv-island-head">
        {topSpace && (
          <span className="cv-island-space" title={`In ${topSpace.name}`}>
            <SpaceAvatar
              color={topSpace.color}
              color2={topSpace.color2}
              icon={topSpace.icon}
              size={16}
            />
          </span>
        )}
        <StripPlaying t={top} here={top.id === here} onGo={() => go(top)} onHover={onHover} />
        {items.length > 1 && (
          <button
            type="button"
            className="cv-island-more"
            aria-expanded={shown}
            aria-label={`${items.length - 1} more playing`}
            title="Everything playing, in every space"
            onClick={() => setOpen((o) => !o)}
          >
            +{items.length - 1}
          </button>
        )}
      </span>
      {shown && (
        <div className="cv-island-list" role="menu" aria-label="Now playing">
          {items.map((t) => (
            <IslandRow key={t.id} t={t} space={spaceOf(t.spaceId)} here={t.id === here} onGo={go} />
          ))}
        </div>
      )}
    </span>
  )
}

/** One row of the island's list: who, where, play or pause, mute, and off the list when it is paused. */
function IslandRow({
  t,
  space,
  here,
  onGo
}: {
  t: PlayingTab
  space?: Space
  here: boolean
  onGo: (t: PlayingTab) => void
}): React.JSX.Element {
  const call = isCapturing(t.capture)
  const [playing, toggle] = usePlayToggle(t)
  const title = playingTitle(t)
  const sounding = t.audible && !t.muted
  return (
    <div className={'cv-island-row' + (call ? ' call' : '') + (here ? ' here' : '')} role="none">
      <button
        type="button"
        role="menuitem"
        className="cv-island-go"
        title={here ? 'On screen now' : call ? 'Go to the call' : 'Go to it'}
        aria-current={here || undefined}
        onClick={() => {
          if (!here) onGo(t)
        }}
      >
        {call ? (
          <span className="cv-strip-call" aria-hidden="true">
            {t.capture.mic && (
              <span className={t.capture.micMuted ? 'off' : 'on'}>
                {t.capture.micMuted ? <MicOffIcon /> : <MicIcon />}
              </span>
            )}
            {t.capture.camera && (
              <span className="on">
                <CameraIcon />
              </span>
            )}
            {t.capture.screen && (
              <span className="on">
                <ScreenIcon />
              </span>
            )}
          </span>
        ) : (
          <span className={'cv-eq' + (sounding ? '' : ' still')} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        <span className="cv-island-title">{title}</span>
        {space && (
          <span className="cv-island-where">
            <SpaceAvatar color={space.color} color2={space.color2} icon={space.icon} size={14} />
            {space.name}
          </span>
        )}
      </button>
      <PlayControls t={t} title={title} call={call} playing={playing} toggle={toggle} />
      {!playing && !t.audible && !call && (
        <button
          type="button"
          className="cv-strip-play-btn"
          aria-label={`Take ${title} off the list`}
          title="Take it off the list"
          onClick={() => window.api.forgetPlaying(t.id)}
        >
          <CloseIcon />
        </button>
      )}
    </div>
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
        className={
          'cv-strip-bell' +
          (open ? ' on' : '') +
          (ring ? ' ring' : '') +
          (waiting.length ? ' has' : ' quiet')
        }
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
