import { memo, useEffect, useRef, useState, useLayoutEffect } from 'react'
import {
  CARD_H,
  CARD_W,
  FRAME_COLORS,
  NOTE_COLORS,
  type CanvasFrame,
  type CanvasNote
} from '@shared/ai/canvas'
import { noteFontSize } from '@shared/ai/canvasText'
import { CloseIcon, IncognitoIcon, SpeakerIcon, TorIcon } from '@renderer/components/icons'
import { CallBadge } from '@renderer/components/CallBadge'
import { firstPage, type FirstPage } from './pdf'
import { sameModel, type CardModel } from './model'
import { AnswerText } from './Expanded'
import { Favicon, Img } from './Img'
import { LiveTab } from './LiveTab'
import {
  ExpandIcon,
  MiniPauseIcon,
  MiniPlayIcon,
  ReaderIcon,
  SnapshotIcon,
  TrashIcon
} from './icons'

const at = (x: number, y: number): React.CSSProperties => ({
  transform: `translate3d(${x}px, ${y}px, 0)`
})

interface CardProps {
  m: CardModel
  x: number
  y: number
  w?: number
  h?: number
  selected: boolean
  fresh: boolean
  lod: boolean
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
  lod,
  onPdf,
  id
}: {
  m: CardModel
  lod: boolean
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
        {page && !lod ? (
          <img src={page.src} alt="" decoding="async" draggable={false} />
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
  lod,
  onPdf,
  onLink
}: {
  m: CardModel
  lod: boolean
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
        </div>
      )
    case 'pdf':
      return <PdfFace m={m} lod={lod} id={m.id} onPdf={onPdf} />
    case 'image':
      return (
        <div className="cv-image">
          <div className="cv-image-in">
            {m.image && !lod ? (
              <Img
                src={m.image}
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
          {(m.image || m.snap) && !lod ? <Img src={m.image ?? m.snap!} /> : null}
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
              {lod ? null : <AnswerText text={m.text} onLink={onLink} />}
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
    default:
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
            {m.image && !lod ? <Hero src={m.image} /> : null}
            <div className="cv-doc-body">
              <span className="cv-site">{m.site}</span>
              <h3>{m.title}</h3>
              {!lod && m.text ? <p>{m.text}</p> : null}
            </div>
          </div>
        )
      }
      return (
        <div className="cv-snap">
          {m.snap && !lod ? (
            <img src={m.snap} alt="" decoding="async" draggable={false} />
          ) : (
            <div className={'cv-snap-ph' + (m.loading ? ' loading' : '')}>
              <span className="cv-ph-icon" aria-hidden="true">
                {lod ? (
                  <span>{(m.site || m.title || '?').charAt(0).toUpperCase()}</span>
                ) : (
                  <Favicon m={m} />
                )}
              </span>
              <h3>{m.title || m.site}</h3>
              <small>{m.site}</small>
              {m.loading && <span className="cv-ph-bar" aria-label="Loading" />}
            </div>
          )}
          {m.snap && !lod && <span className="cv-cap">{m.site || m.title}</span>}
        </div>
      )
  }
}

/** A page's hero picture; one that will not load is left out. */
function Hero({ src }: { src: string }): React.JSX.Element {
  return (
    <div className="cv-hero">
      <Img src={src} />
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
function MediaControls({ m }: { m: CardModel }): React.JSX.Element {
  // what the page said last, until the tab's own state catches up (main asks the page what plays)
  const now = !!(m.playing ?? m.audible)
  const [said, setSaid] = useState<{ was: boolean; paused: boolean } | null>(null)
  const playing = said && said.was === now ? !said.paused : now
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
            .then((r) => r && setSaid({ was: now, paused: r.paused }))
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
    lod,
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
    const cardAspect = w / h
    return (
      <div
        className={
          'cv-card k-' +
          m.kind +
          (selected ? ' sel' : '') +
          (m.current ? ' current' : '') +
          (fresh ? ' fresh' : '') +
          (hidden ? ' away' : '')
        }
        data-cid={m.id}
        style={
          {
            ...at(x, y),
            width: w,
            height: h,
            '--i': Math.min(rank, 16)
          } as React.CSSProperties
        }
        role="button"
        aria-pressed={selected}
        aria-label={label}
      >
        <Face m={m} lod={lod} onPdf={onPdf} onLink={onLink} />
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
        {m.kind !== 'pending' && (
          <>
            {RZ.map((d) => (
              <i
                key={d}
                className={'cv-crz ' + d}
                data-crz={d}
                data-crzc={m.id}
                aria-hidden="true"
              />
            ))}
            <div className="cv-badges">
              <CallBadge call={m.ringing ? 'ringing' : null} />
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
    a.lod === b.lod &&
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
  editing: boolean
  onRename: (id: string, name: string | null) => void
  onEdit: (id: string) => void
  /** Open a folded frame (a stack) back into its cards. */
  onFan?: (id: string) => void
}

export const FrameView = memo(function FrameView({
  frame,
  count,
  selected,
  editing,
  onRename,
  onEdit,
  onFan
}: FrameProps): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    }
  }, [editing])
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
        ...at(note.x, note.y),
        width: note.w,
        height: note.h,
        fontSize: noteFontSize(text)
      }}
      onDoubleClick={() => onEdit(note.id)}
    >
      <div className="cv-note-measure" ref={measure} aria-hidden="true">
        {text || 'Double-click to write'}
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
            if (e.key === 'Escape') e.currentTarget.blur()
          }}
          onBlur={(e) => {
            setDraft(null)
            onText(note.id, e.currentTarget.value)
          }}
        />
      ) : (
        <p>{note.text || <span className="cv-note-empty">Double-click to write</span>}</p>
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
