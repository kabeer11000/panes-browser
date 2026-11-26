import { LiveCardVideo } from './LiveShare'
import { Inline } from './Inline'
import { memo, useEffect, useRef, useState, useLayoutEffect } from 'react'
import {
  CARD_H,
  CARD_UNDER,
  CARD_W,
  FRAME_COLORS,
  NOTE_COLORS,
  type CanvasFrame,
  type CanvasNote
} from '@shared/ai/canvas'
import { noteFontSize } from '@shared/ai/canvasText'
import { CloseIcon, IncognitoIcon, SpeakerIcon, TorIcon } from '@renderer/components/icons'
import { CallBadge } from '@renderer/components/CallBadge'
import { CaptureBadge } from '@renderer/components/CaptureBadge'
import { badgeText } from '@shared/attention'
import { firstPage, type FirstPage } from './pdf'
import { sameModel, type CardModel } from './model'
import { AnswerText } from './Expanded'
import { Favicon } from './Img'
import { Pic } from './Pic'
import { useHostViews } from '@renderer/liveHost'
import { markFor, toggleMark } from '@shared/noteMarks'
import { useBoardLod } from './boardLod'
import { LiveTab } from './LiveTab'
import {
  ExpandIcon,
  MiniPauseIcon,
  MiniPlayIcon,
  ReaderIcon,
  SnapshotIcon,
  TrashIcon
} from './icons'

/**
 * Placed on the board. A 2D translate, not translate3d: a 3D one gives every card a layer of its own, and a board of
 * them (with their buttons) was hundreds of layers, each drawn again at every step of a zoom, where one layer for the
 * board scales as a whole. A card being dragged gets its own layer then (translate3d, set by the drag).
 */
const at = (x: number, y: number): React.CSSProperties => ({
  transform: `translate(${x}px, ${y}px)`
})
/**
 * Placed like `at`, turning and scaling about its own middle: the origin is on the board's coordinates (where the
 * transform puts the box), so the lean of a drag (lift.ts, the `rotate` and `scale` properties) pivots on the card
 * and not on the board's corner.
 */
const atMid = (x: number, y: number, w: number, h: number): React.CSSProperties =>
  ({
    ...at(x, y),
    // board.css: transform-origin: var(--ox) var(--oy) (a group being dragged sets its own pivot over it)
    '--ox': `${x + w / 2}px`,
    '--oy': `${y + h / 2}px`
  }) as React.CSSProperties

interface CardProps {
  m: CardModel
  x: number
  y: number
  w?: number
  h?: number
  selected: boolean
  fresh: boolean
  hidden: boolean
  rank: number
  onClose: (id: number) => void
  onExpand: (id: number) => void
  /** The page of a PDF is known: remember how many pages it has. */
  onPdf: (id: number, f: FirstPage) => void
  /** Switch a page card between its words and the picture of the page. */
  onView: (id: number) => void
  /** A link in an answer: it opens as a card. */
  onLink: (href: string) => void
  /** Open the menu that changes how the card is placed. */
  onPlace?: (id: number, x: number, y: number) => void
  /** The card's on-screen width when its tab plays live on it (a tab stream), else 0. */
  live?: number
  /** Reported aspect ratio of a live video stream on the card. */
  onVideoAspect?: (id: number, aspect: number) => void
  /** The last frame a live card showed, kept as its picture once the stream stops. */
  onStill?: (id: number, src: string) => void
  /** Its tab is in a call: the live picture is the whole page (all its people), not one video. */
  call?: boolean
}

function PdfFace({
  m,
  onPdf,
  id
}: {
  m: CardModel
  id: number
  onPdf: CardProps['onPdf']
}): React.JSX.Element {
  const [page, setPage] = useState<FirstPage | null>(null)
  const [failed, setFailed] = useState(false)
  const key = m.pdf?.file ?? m.pdf?.url ?? ''
  useEffect(() => {
    if (!m.pdf) return
    let dead = false
    void firstPage(m.pdf).then((f) => {
      if (dead) return
      if (f) {
        setPage(f)
        onPdf(id, f)
      } else setFailed(true)
    })
    return () => {
      dead = true
    }
    // the source decides what is drawn; the model object itself changes more often than that
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return (
    <div className="cv-pdf">
      <div
        className="cv-sheet"
        style={{ '--ar': page ? String(page.aspect) : '0.707' } as React.CSSProperties}
      >
        {page ? (
          <Pic src={page.src} fallback={<span className="cv-sheet-ph" />} />
        ) : (
          <span className={'cv-sheet-ph' + (failed ? ' failed' : '')}>{failed ? 'PDF' : ''}</span>
        )}
        <span className="cv-hover-cap">
          {m.title}
          {m.site ? <small>{m.site}</small> : null}
        </span>
      </div>
      <span className="cv-chip">
        {(page?.pages ?? m.pages)
          ? `${page?.pages ?? m.pages} ${(page?.pages ?? m.pages) === 1 ? 'page' : 'pages'}`
          : 'PDF'}
      </span>
    </div>
  )
}

function Face({
  m,
  onPdf,
  onLink,
  onAspect
}: {
  m: CardModel
  /** The shape of what the card holds, once known (an image's, a video's poster): the card takes it. */
  onAspect?: (ar: number) => void
  onPdf: CardProps['onPdf']
  onLink: CardProps['onLink']
}): React.JSX.Element {
  switch (m.kind) {
    case 'pending':
      return <div className="cv-shimmer" aria-hidden="true" />
    case 'private':
      return (
        <div className="cv-private" aria-hidden="true">
          {m.tor ? <TorIcon /> : <IncognitoIcon />}
          <span>{m.tor ? 'Tor tab' : 'Private tab'}</span>
          {(m.title || m.site) && (
            <span className="cv-private-what">
              {m.title && !/^(Private|Tor) tab$/.test(m.title) && <b>{m.title}</b>}
              {m.site && <small>{m.site}</small>}
            </span>
          )}
        </div>
      )
    case 'pdf':
      return <PdfFace m={m} id={m.id} onPdf={onPdf} />
    case 'image':
      return (
        <div className="cv-image">
          <div className="cv-image-in">
            {m.image ? (
              <Pic
                src={m.image}
                onSize={(w, h) => onAspect?.(w / h)}
                fallback={
                  <div className="cv-sheet-ph" style={{ position: 'static', height: 160 }} />
                }
              />
            ) : (
              <div className="cv-sheet-ph" style={{ position: 'static', height: 160 }} />
            )}
            <span className="cv-hover-cap">
              {m.title}
              {m.site ? <small>{m.site}</small> : null}
            </span>
          </div>
        </div>
      )
    case 'video':
      return (
        <div className="cv-video">
          {m.image || m.snap ? (
            <Pic
              src={m.image ?? m.snap!}
              // a video's own still (a file's first frame) has its shape; YouTube's posters are 4:3 with black
              // bars whatever the video, so those wait for the video itself (a live card measures it)
              onSize={(w, h) => {
                const src = m.image ?? m.snap ?? ''
                if (m.image && !/ytimg\.com|youtube/.test(src)) onAspect?.(w / h)
              }}
            />
          ) : null}
          <span className="cv-hover-cap">
            {m.title}
            {m.site ? <small>{m.site}</small> : null}
          </span>
        </div>
      )
    case 'answer':
      return (
        <div className="cv-answer">
          <span className="cv-kicker">{m.placement === 'note' ? 'Note' : 'Answer'}</span>
          <p className="cv-answer-q">{m.title}</p>
          {m.text ? (
            <div className="cv-answer-text">
              <AnswerBody text={m.text} onLink={onLink} />
            </div>
          ) : (
            <span className="cv-thinking" aria-label="Thinking">
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
      )
    default: {
      if (m.blank) {
        return (
          <div className="cv-blank">
            <span className="cv-blank-plus" aria-hidden="true">
              <PlusGlyph />
            </span>
            <span>New tab</span>
          </div>
        )
      }
      if (m.reader) {
        return (
          <div className="cv-doc">
            {m.image ? <Hero src={m.image} /> : null}
            <div className="cv-doc-body">
              <span className="cv-site">{m.site}</span>
              <h3>{m.title}</h3>
              {m.text ? <p>{m.text}</p> : null}
            </div>
          </div>
        )
      }
      const placeholder = (
        <div className={'cv-snap-ph' + (m.loading ? ' loading' : '')}>
          <span className="cv-ph-icon" aria-hidden="true">
            <Favicon m={m} />
          </span>
          <h3>{m.title || m.site}</h3>
          <small>{m.site}</small>
          {m.loading && <span className="cv-ph-bar" aria-label="Loading" />}
        </div>
      )
      return (
        <div className="cv-snap">
          {m.snap ? <Pic src={m.snap} fallback={placeholder} /> : placeholder}
        </div>
      )
    }
  }
}

/** An answer's text, left out while the board is zoomed far out (a few pixels high, and the costliest to draw). */
function AnswerBody({
  text,
  onLink
}: {
  text: string
  onLink: CardProps['onLink']
}): React.JSX.Element | null {
  return useBoardLod() ? null : <AnswerText text={text} onLink={onLink} />
}

/** A page's hero picture; one that will not load is left out. */
function Hero({ src }: { src: string }): React.JSX.Element {
  return (
    <div className="cv-hero">
      <Pic src={src} />
    </div>
  )
}

const PlusGlyph = (): React.JSX.Element => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M8 3v10M3 8h10" />
  </svg>
)

/**
 * One piece of content on the board. It draws what it is: a document page, a PDF's first page, a picture at its
 * own proportions, a video's poster, an answer. Memoised: panning or a change elsewhere must not touch it.
 */
/**
 * Sound and video from the card itself: mute, and play or pause (shown while it plays, or on hover). The tab stays
 * where it is; nothing opens.
 */
/** The tab shown live to a shared space: a red LIVE tag on its card, so it is never forgotten (liveHost.ts). */
function LiveBadge({ tabId }: { tabId: number }): React.JSX.Element | null {
  const live = useHostViews().some((v) => v.tabId === tabId)
  return live ? (
    <span className="cv-live-tag" title="Shown live to your shared space">
      Live
    </span>
  ) : null
}

function MediaControls({ m }: { m: CardModel }): React.JSX.Element {
  // What the page answered to the last click, until the tab's own state (main asks the page what plays) moves:
  // any change of that is the truth from then on, so a pause made in the page itself is never hidden by an old
  // click. The answer also lapses after a moment, in case main's state never moves.
  const now = !!(m.playing ?? m.audible)
  const [said, setSaid] = useState<{ paused: boolean; n: number } | null>(null)
  const [seen, setSeen] = useState(now)
  if (seen !== now) {
    setSeen(now)
    setSaid(null)
  }
  const clicks = useRef(0)
  const playing = said ? !said.paused : now
  return (
    <span className={'cv-media' + (m.audible || m.muted || m.playing ? ' on' : '')}>
      <button
        type="button"
        className="cv-mbtn"
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause' : 'Play'}
        onClick={(e) => {
          e.stopPropagation()
          void window.api
            .mediaPlay?.(m.id, playing ? 'pause' : 'play')
            .then((r) => {
              if (!r) return
              const n = ++clicks.current
              setSaid({ paused: r.paused, n })
              window.setTimeout(() => setSaid((x) => (x?.n === n ? null : x)), 3000)
            })
            .catch(() => undefined)
        }}
      >
        {playing ? <MiniPauseIcon /> : <MiniPlayIcon />}
      </button>
      {(m.audible || m.muted) && (
        <button
          type="button"
          className={'cv-mbtn' + (m.muted ? ' muted' : '')}
          aria-label={m.muted ? 'Unmute' : 'Mute'}
          title={m.muted ? 'Unmute' : 'Mute'}
          onClick={(e) => {
            e.stopPropagation()
            window.api.toggleMute(m.id)
          }}
        >
          <SpeakerIcon muted={m.muted} />
        </button>
      )}
    </span>
  )
}

export const CardView = memo(
  function CardView({
    m,
    x,
    y,
    w = CARD_W,
    h = CARD_H,
    selected,
    fresh,
    hidden,
    rank,
    onClose,
    onExpand,
    onPdf,
    onView,
    onLink,
    onPlace,
    live = 0,
    onVideoAspect,
    onStill,
    call = false
  }: CardProps): React.JSX.Element {
    const label = `${m.title}${m.site ? `, ${m.site}` : ''}${m.kind === 'pdf' ? ', PDF' : m.kind === 'image' ? ', image' : m.kind === 'video' ? ', video' : m.kind === 'answer' ? ', answer' : ''}${m.current ? ', current tab' : ''}`
    // A page, video, picture or PDF floats as its picture with its name under it (the title row is part of the
    // card's height, see CARD_UNDER); a reader view, an answer, a new tab keep their whole card.
    const titled =
      (m.kind === 'page' && !m.blank && !m.reader) ||
      m.kind === 'video' ||
      m.kind === 'image' ||
      m.kind === 'pdf'
    const cardAspect = w / (titled ? Math.max(1, h - CARD_UNDER) : h)
    // Its eight resize handles exist only while it is under the pointer or selected: on every card they were 1200 on
    // a board of 150, and hiding them all as the board zoomed far out or a drag began cost 25 to 35 ms of styles.
    // Kept through a press (a resize drag can leave the card), so the handle being dragged is never taken away.
    const [hot, setHot] = useState(false)
    return (
      <div
        onPointerEnter={() => setHot(true)}
        onPointerLeave={(e) => {
          if (e.buttons === 0) setHot(false)
        }}
        className={
          'cv-card k-' +
          m.kind +
          (selected ? ' sel' : '') +
          (m.current ? ' current' : '') +
          (titled ? ' titled' : '') +
          (fresh ? ' fresh' : '') +
          (hidden ? ' away' : '') +
          (m.asleep ? ' asleep' : '')
        }
        data-cid={m.id}
        style={
          {
            ...atMid(x, y, w, h),
            width: w,
            height: h,
            '--i': Math.min(rank, 16)
          } as React.CSSProperties
        }
        role="button"
        aria-pressed={selected}
        aria-label={label}
      >
        <Face
          m={m}
          onPdf={onPdf}
          onLink={onLink}
          onAspect={onVideoAspect ? (ar) => onVideoAspect(m.id, ar) : undefined}
        />
        {titled && (
          <div className="cv-under" aria-hidden="true">
            <b>{m.title || m.site}</b>
            {m.title && m.site ? <span>{m.site}</span> : null}
          </div>
        )}
        {m.liveRtc !== undefined && m.liveSpace !== undefined && (
          <LiveCardVideo spaceId={m.liveSpace} hostRtc={m.liveRtc} w={w} h={h} />
        )}
        {live > 0 && m.isTab && (
          <LiveTab
            key={call ? 'call' : 'video'}
            whole={call}
            id={m.id}
            cardPx={live}
            cardAspect={cardAspect}
            site={m.site}
            title={m.title}
            onAspect={onVideoAspect}
            onStill={onStill}
          />
        )}
        {/* who the page is, floating on its picture (a snapshot, a video, a live stream): on the card under the
            pointer or selected, every kind alike; drawn only there, so the board's other cards cost nothing for it */}
        {(hot || selected) &&
          !titled &&
          (live > 0 ||
            (m.kind === 'video' && !!(m.image || m.snap)) ||
            (m.kind === 'page' && !m.blank && !m.reader && !!m.snap)) && (
            <span className="cv-tag">
              <Favicon m={m} />
              <span>{m.site || m.title}</span>
            </span>
          )}
        {m.kind !== 'pending' && (
          <>
            {(hot || selected) &&
              RZ.map((d) => (
                <i
                  key={d}
                  className={'cv-crz ' + d}
                  data-crz={d}
                  data-crzc={m.id}
                  aria-hidden="true"
                />
              ))}
            {/* something new in the tab: a count on the card's corner, as on an app icon (a dot with no number) */}
            {m.attnNew && !m.ringing && (
              <span
                className={'cv-count' + (m.attnCount ? '' : ' dot')}
                role="img"
                aria-label={m.attnCount ? `${m.attnCount} new` : 'Something new'}
                title={m.attnCount ? `${m.attnCount} new` : 'Something new'}
              >
                {m.attnCount ? badgeText(m.attnCount) : ''}
              </span>
            )}
            <div className="cv-badges">
              {m.isTab && <LiveBadge tabId={m.id} />}
              {m.sharedOut && (
                <span
                  className={'cv-shared-tag' + (m.sharedOut === 'paused' ? ' paused' : '')}
                  role="img"
                  aria-label={
                    m.sharedOut === 'paused'
                      ? 'Sharing paused: this tab is on another site now'
                      : 'Shared with everyone in this space'
                  }
                  title={
                    m.sharedOut === 'paused'
                      ? 'Sharing paused: this tab went to another site, so the others still see the page you shared. Right-click to share this page'
                      : 'Shared with everyone in this space. Right-click to stop sharing'
                  }
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="6" cy="5.5" r="2.4" />
                    <path d="M1.8 13c.5-2.4 2.2-3.7 4.2-3.7s3.7 1.3 4.2 3.7" />
                    <path d="M10.6 3.4a2.3 2.3 0 0 1 0 4.3M12 9.6c1.2.5 2 1.6 2.3 3.4" />
                  </svg>
                </span>
              )}
              {m.ownerName && !m.liveBy && (
                <span
                  className="cv-owner-tag"
                  style={{ '--oc': m.ownerColor ?? '#888' } as React.CSSProperties}
                  title={`${m.ownerName}'s tab, shared with everyone here`}
                >
                  <i aria-hidden="true">{m.ownerName.slice(0, 1).toUpperCase()}</i>
                  {m.ownerName.split(' ')[0]}
                </span>
              )}
              {m.liveBy && (
                <span
                  className="cv-live-tag"
                  title={`${m.liveBy} is showing this live. Open it to watch`}
                >
                  Live · {m.liveBy.split(' ')[0]}
                </span>
              )}
              <CallBadge call={m.ringing ? 'ringing' : null} />
              <CaptureBadge
                capture={{
                  camera: !!m.camera,
                  mic: !!m.mic,
                  screen: !!m.screen,
                  micMuted: !!m.micMuted
                }}
              />
              {m.isTab && (m.audible || m.muted || m.kind === 'video') && <MediaControls m={m} />}
              {m.current && (
                <span className="card-current" title="Current tab" aria-hidden="true" />
              )}
            </div>
            <div className="cv-acts">
              {m.toggle && (
                <button
                  type="button"
                  className="cv-act"
                  aria-label={m.reader ? 'Show the page' : 'Show as reader'}
                  title={m.reader ? 'Show the page (snapshot)' : 'Show as reader'}
                  onClick={() => onView(m.id)}
                >
                  {m.reader ? <SnapshotIcon /> : <ReaderIcon />}
                </button>
              )}
              <button
                type="button"
                className="cv-act"
                aria-label={`Open ${m.title}`}
                title="Open (Enter)"
                onClick={() => onExpand(m.id)}
              >
                <ExpandIcon />
              </button>
              <button
                type="button"
                className="cv-act"
                aria-label={`${m.isTab ? 'Close' : 'Remove'} ${m.title}`}
                title={m.isTab ? 'Close tab' : 'Remove from board'}
                onClick={() => onClose(m.id)}
              >
                <CloseIcon />
              </button>
            </div>
            {m.chip && m.placement && onPlace && (
              <button
                type="button"
                className="cv-chip-place"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  onPlace(m.id, r.left, r.bottom + 6)
                }}
              >
                Added as {m.placement === 'live' ? 'live page' : m.placement}
                <b>Change</b>
              </button>
            )}
          </>
        )}
      </div>
    )
  },
  (a, b) =>
    a.x === b.x &&
    a.y === b.y &&
    a.w === b.w &&
    a.h === b.h &&
    a.selected === b.selected &&
    a.fresh === b.fresh &&
    a.hidden === b.hidden &&
    a.rank === b.rank &&
    a.onClose === b.onClose &&
    a.onExpand === b.onExpand &&
    a.onPdf === b.onPdf &&
    a.onView === b.onView &&
    a.onPlace === b.onPlace &&
    a.onLink === b.onLink &&
    a.onVideoAspect === b.onVideoAspect &&
    a.onStill === b.onStill &&
    a.call === b.call &&
    a.live === b.live &&
    sameModel(a.m, b.m)
)

interface FrameProps {
  frame: CanvasFrame
  count: number
  selected: boolean
  /** Its name is being edited (in FrameHead): no resize handles meanwhile. */
  editing: boolean
  /** Open a folded frame (a stack) back into its cards. */
  onFan?: (id: string) => void
}

export const FrameView = memo(function FrameView({
  frame,
  count,
  selected,
  editing,
  onFan
}: FrameProps): React.JSX.Element {
  return (
    <div
      className={
        'cv-frame ' +
        frame.kind +
        (frame.color !== undefined ? ` fc${frame.color % FRAME_COLORS}` : '') +
        (frame.stack ? ' stack' : '') +
        (selected ? ' sel' : '')
      }
      data-fid={frame.id}
      style={{ ...at(frame.x, frame.y), width: frame.w, height: frame.h }}
    >
      {!editing && (
        <>
          {RZ.map((d) => (
            <i
              key={d}
              className={'cv-rz ' + d}
              data-rz={d}
              data-rzf={frame.id}
              aria-hidden="true"
            />
          ))}
        </>
      )}
      {frame.stack && (
        <button
          type="button"
          className="cv-stack-open"
          aria-label={`Open ${frame.name}, ${count} cards`}
          onClick={() => onFan?.(frame.id)}
        >
          <b>{count}</b>
          <span>Open</span>
        </button>
      )}
    </div>
  )
})

interface FrameHeadProps {
  frame: CanvasFrame
  count: number
  editing: boolean
  onRename: (id: string, name: string | null) => void
  onEdit: (id: string) => void
}

/**
 * A section's name, above its top edge. It is drawn in its own layer after every card (not inside its section, which
 * sits under the cards), so a section close below another never has its name under that one's cards. It carries its
 * section's `data-fid`, so dragging the section and the board's glides move it with it.
 */
export const FrameHead = memo(function FrameHead({
  frame,
  count,
  editing,
  onRename,
  onEdit
}: FrameHeadProps): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) {
      input.current?.focus({ preventScroll: true })
      input.current?.select()
    }
  }, [editing])
  return (
    <div
      className={
        'cv-fhead-at ' +
        frame.kind +
        (frame.color !== undefined ? ` fc${frame.color % FRAME_COLORS}` : '')
      }
      data-fid={frame.id}
      style={{ ...at(frame.x, frame.y), width: frame.w }}
    >
      <div className="cv-frame-head" data-fhead={frame.id}>
        {frame.kind === 'private' && (
          <span className="cv-frame-icon">
            <IncognitoIcon />
          </span>
        )}
        {editing ? (
          <input
            ref={input}
            className="cv-frame-input"
            defaultValue={frame.name}
            maxLength={40}
            aria-label="Frame name"
            spellCheck={false}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') onRename(frame.id, e.currentTarget.value)
              else if (e.key === 'Escape') onRename(frame.id, null)
            }}
            onBlur={(e) => onRename(frame.id, e.currentTarget.value)}
          />
        ) : (
          <span
            className="cv-frame-name"
            title="Double-click to rename"
            onDoubleClick={() => onEdit(frame.id)}
          >
            {frame.name}
          </span>
        )}
        <span className="cv-frame-count" aria-label={`${count} items`}>
          {count}
        </span>
      </div>
    </div>
  )
})

const RZ = ['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw'] as const

/**
 * The popover for a selected frame: its colour, rename and delete. It sits on the screen, not on the board: above
 * the frame (below it when there is no room), moved in from the window's sides so it is never cut off.
 */
export function FrameBar({
  frame,
  at,
  onColor,
  onRename,
  onDelete
}: {
  frame: CanvasFrame
  /** The middle of the frame's top edge (its bottom when `below`), in px within the board's box. */
  at: { x: number; y: number; below: boolean }
  onColor: (id: string, c: number | null) => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
}): React.JSX.Element {
  const bar = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(at.x)
  useLayoutEffect(() => {
    const el = bar.current
    const room = el?.offsetParent?.clientWidth
    if (!el || !room) return
    const half = el.offsetWidth / 2
    const margin = 10
    setLeft(Math.min(room - margin - half, Math.max(margin + half, at.x)))
  }, [at.x])
  const swatches: Array<number | null> = [
    null,
    ...Array.from({ length: FRAME_COLORS }, (_, i) => i)
  ]
  return (
    <div
      ref={bar}
      className={'cv-fbar screen' + (at.below ? ' below' : '')}
      style={{ left, top: Math.max(10, at.y) }}
      role="toolbar"
      aria-label="Frame"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {swatches.map((c) => (
        <button
          key={String(c)}
          type="button"
          className={
            'cv-swatch' + (c === null ? '' : ` fc${c}`) + ((frame.color ?? null) === c ? ' on' : '')
          }
          aria-label={c === null ? 'Space colour' : `Colour ${c + 1}`}
          title={c === null ? 'Space colour' : 'Colour'}
          onClick={() => onColor(frame.id, c)}
        />
      ))}
      <span className="cv-ksep" aria-hidden="true" />
      <button type="button" className="cv-kbtn wide" onClick={() => onRename(frame.id)}>
        Rename
      </button>
      <button
        type="button"
        className="cv-kbtn"
        aria-label="Delete section and close its tabs"
        title="Delete section and close its tabs (Undo brings them back)"
        onClick={() => onDelete(frame.id)}
      >
        <TrashIcon />
      </button>
    </div>
  )
}

interface NoteProps {
  note: CanvasNote
  selected: boolean
  editing: boolean
  onText: (id: string, text: string | null) => void
  onEdit: (id: string) => void
  onColor: (id: string) => void
  /** The text's height at the note's width (the note sizes itself to it). */
  onSize: (id: string, textH: number) => void
  /** The key that started typing into it (the first character), when it is being edited. */
  first?: string | null
}

export const NoteView = memo(function NoteView({
  note,
  selected,
  editing,
  onText,
  onEdit,
  onColor,
  onSize,
  first = null
}: NoteProps): React.JSX.Element {
  const area = useRef<HTMLTextAreaElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  // what is typed right now: the note grows and shrinks with it as it is written
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => {
    const a = area.current
    if (!editing || !a) return
    if (first) {
      a.value = note.text + first
      setDraft(a.value)
    }
    a.focus()
    a.setSelectionRange(a.value.length, a.value.length)
    // only as editing starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])
  const text = editing && draft !== null ? draft : note.text
  // the text's own height, at the note's width, measured off to the side (the note itself has a fixed box)
  useEffect(() => {
    const el = measure.current
    if (!el) return
    const ro = new ResizeObserver(() => onSize(note.id, el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [note.id, onSize])
  return (
    <div
      className={'cv-note c' + (note.color % NOTE_COLORS) + (selected ? ' sel' : '')}
      data-nid={note.id}
      // like a FigJam sticky: the text is large while it is short, and shrinks before the note grows
      style={{
        ...atMid(note.x, note.y, note.w, note.h),
        width: note.w,
        height: note.h,
        fontSize: noteFontSize(text)
      }}
      onDoubleClick={() => onEdit(note.id)}
    >
      <div className="cv-note-measure" ref={measure} aria-hidden="true">
        {/* writing shows the markers as typed; at rest they are drawn (and take less room) */}
        {text ? editing ? text : <Inline text={text} /> : 'Double-click to write'}
        {'\u200b'}
      </div>
      {editing ? (
        <textarea
          ref={area}
          defaultValue={note.text}
          maxLength={600}
          aria-label="Note"
          placeholder="Write something"
          onPointerDown={(e) => e.stopPropagation()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            // Esc ends typing and keeps what was typed (the note stays selected)
            if (e.key === 'Escape') return e.currentTarget.blur()
            // Ctrl+B bold, Ctrl+I italic, Ctrl+Shift+X struck through, as in Figma
            const marker = markFor(e)
            if (!marker) return
            e.preventDefault()
            const t = e.currentTarget
            const r = toggleMark(t.value, t.selectionStart, t.selectionEnd, marker)
            t.value = r.value.slice(0, 600)
            t.setSelectionRange(r.start, r.end)
            setDraft(t.value)
          }}
          onBlur={(e) => {
            setDraft(null)
            onText(note.id, e.currentTarget.value)
          }}
        />
      ) : (
        <p>
          {note.text ? (
            <Inline text={note.text} />
          ) : (
            <span className="cv-note-empty">Double-click to write</span>
          )}
        </p>
      )}
      {!editing &&
        (['e', 's', 'se'] as const).map((d) => (
          <i
            key={d}
            className={'cv-nrz ' + d}
            data-nrz={d}
            data-nrzn={note.id}
            aria-hidden="true"
          />
        ))}
      {selected && !editing && (
        <button
          type="button"
          className="cv-note-color"
          aria-label="Change note colour"
          title="Change colour"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onColor(note.id)}
        />
      )}
    </div>
  )
})
