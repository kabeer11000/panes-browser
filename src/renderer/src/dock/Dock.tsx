import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DockApi,
  DockMode,
  DockOverlayState,
  DownloadInfo,
  DownloadStart
} from '../../../shared/types'
import { formatBytes } from '../internal/format'
import { CloseIcon } from '../components/icons'

declare global {
  interface Window {
    dock: DockApi
  }
}

// Geometry, in step with the main process (see dock.ts): the bin's view is WIDTH by HEIGHT at the window's corner (INSET short of
// its right edge); the bin sits MARGIN_R from that edge and MARGIN_B from the bottom; tucked away only the top SLIVER
// of the view shows.
const HEIGHT = 96
const SLIVER = 12
const BIN = 68
const INSET = 8 // the window's right edge left free by the bin's view
const MARGIN_R = 24
const MARGIN_B = 16
const BASE_ROW = HEIGHT - MARGIN_B - BIN // the bin's top, in the view, when it is out
const HIDE_Y = HEIGHT - SLIVER - BASE_ROW // how far below its place the bin is, with the view at the edge
const PEEK_Y = -BASE_ROW // and how far above it, when the view has dropped to the edge (it shows the top)
const FAN_MAX = 7
const ROW_H = 52
const FAN_GAP = 6
const FLIGHT_S = 0.72
const LINGER_MS = 1700

const extOf = (name: string): string =>
  (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? 'file').toUpperCase()
const active = (d: DownloadInfo): boolean => d.state === 'progressing' || d.state === 'paused'

function useDownloads(): DownloadInfo[] {
  const [list, setList] = useState<DownloadInfo[]>([])
  useEffect(() => {
    let alive = true
    void window.dock.downloads().then((l) => alive && setList(l))
    const off = window.dock.onDownloads(setList)
    return () => {
      alive = false
      off()
    }
  }, [])
  return list
}

/** A file's face: its preview when it has one, else a tile with its extension. */
function Face({ d, size }: { d: DownloadInfo; size: number }): React.JSX.Element {
  return d.preview ? (
    <span
      className="dk-face"
      style={{ width: size, height: size, backgroundImage: `url(${d.preview})` }}
    />
  ) : (
    <span className="dk-face ext" style={{ width: size, height: size }}>
      {extOf(d.filename).slice(0, 4)}
    </span>
  )
}

interface Flight {
  key: number
  from: { x: number; y: number }
  to: { x: number; y: number }
  name: string
}

/** Keyframes along a gentle arc from one point to another, easing in and out, shrinking as it goes. */
function path(f: Flight): {
  x: number[]
  y: number[]
  scale: number[]
  rotate: number[]
  opacity: number[]
} {
  const steps = 12
  const dist = Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y)
  const arc = Math.min(140, dist * 0.28)
  const out = {
    x: [] as number[],
    y: [] as number[],
    scale: [] as number[],
    rotate: [] as number[],
    opacity: [] as number[]
  }
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const e = t * t * (3 - 2 * t)
    out.x.push(f.from.x + (f.to.x - f.from.x) * e - 20)
    out.y.push(f.from.y + (f.to.y - f.from.y) * e - Math.sin(Math.PI * e) * arc - 24)
    out.scale.push(1.15 - 0.85 * e)
    out.rotate.push(-16 * Math.sin(Math.PI * e) + 8 * e)
    out.opacity.push(t < 0.08 ? t / 0.08 : t > 0.92 ? (1 - t) / 0.08 : 1)
  }
  return out
}

const FAN_HASH = '#overlay'

/** The bin's centre, in the fan view (window-sized): the bin's view stops INSET short of the window's right edge. */
function binCentre(): { x: number; y: number } {
  return {
    x: window.innerWidth - INSET - MARGIN_R - BIN / 2,
    y: window.innerHeight - MARGIN_B - BIN / 2
  }
}

/**
 * The downloads bin lives in two views (see dock.ts), and this is both: the bin, and the fan. The bin lives off the
 * window's bottom-right edge with a sliver of itself showing, so it is known to be there, and comes out when the pointer
 * rests in the corner, and when something starts downloading. Clicking it fans the recent downloads out above it, as
 * the Downloads stack on a Mac does, and a new file flies to it from where the pointer was; both happen in the fan
 * view, a window-sized view that is only shown while it is needed.
 */
export function Dock(): React.JSX.Element {
  return location.hash === FAN_HASH ? <Fan /> : <Bin />
}

/** The bin: a small view that is only ever moved, never resized, so there is no frame of it in the wrong place. */
function Bin(): React.JSX.Element {
  const list = useDownloads()
  const [overlay, setOverlay] = useState<DockOverlayState>({ open: false, active: false })
  const [pointer, setPointer] = useState(false)
  const [corner, setCorner] = useState(false)
  const [linger, setLinger] = useState(false)
  const ty = useMotionValue(PEEK_Y)
  const shown = useRef<DockMode>('peek') // what the main process has been told
  const leave = useRef<number | undefined>(undefined)
  const lingerTimer = useRef<number | undefined>(undefined)
  const squash = useRef<HTMLDivElement>(null)
  // The fan was closed with the pointer still near the corner: the bin goes away and stays away until the pointer has
  // left the corner (otherwise the pointer, still over where it was, would bring it straight back).
  const [dismissed, setDismissed] = useState(false)
  const cornerNow = useRef(false)
  const wasActive = useRef(false)

  const mode: DockMode =
    overlay.active || (!dismissed && (pointer || corner || linger)) ? 'out' : 'peek'

  useEffect(
    () =>
      window.dock.onCorner((here) => {
        cornerNow.current = here
        setCorner(here)
        if (!here) setDismissed(false)
      }),
    []
  )
  useEffect(() => window.dock.onOverlay(setOverlay), [])
  useEffect(() => {
    if (wasActive.current && !overlay.active && cornerNow.current) setDismissed(true)
    wasActive.current = overlay.active
  }, [overlay.active])
  // sunk below the edge before the pane view covers it, and raised again a beat after it has gone
  useEffect(
    () =>
      window.dock.onSlide((kind) => {
        if (shown.current !== 'peek') return
        const below = PEEK_Y + SLIVER + 12
        if (kind === 'sink') void animate(ty, below, { duration: 0.18, ease: 'easeIn' })
        else if (kind === 'tuck') ty.set(below)
        else void animate(ty, PEEK_Y, { type: 'spring', stiffness: 340, damping: 24 })
      }),
    [ty]
  )

  // the bin's slide, in step with the view's move to the edge or away from it
  useEffect(() => {
    let cancelled = false
    let controls: { stop: () => void } | null = null
    let riseTimer: number | undefined
    if (mode === 'peek') {
      if (shown.current === 'peek') return
      const settle = (): void => {
        if (cancelled) return
        window.dock.setMode('peek')
        ty.set(PEEK_Y)
        shown.current = 'peek'
        setPointer(false) // the view has moved from under the pointer, and says nothing of it
      }
      // slide down to the edge, then let the view drop to it too (the bin keeps its place on screen)
      if (Math.abs(ty.get() - HIDE_Y) < 0.5)
        settle() // already there (the rise never started): nothing to wait for
      else {
        controls = animate(ty, HIDE_Y, { type: 'spring', stiffness: 380, damping: 34 })
        void (controls as unknown as Promise<void>).then(settle)
      }
    } else {
      // the view rises to the bin's place; the bin starts where it was, at the edge, and slides up
      window.dock.setMode(mode)
      ty.set(HIDE_Y)
      shown.current = mode
      // a moment for the view to take its new place before the bin slides up (a timer: frames do not run while hidden)
      riseTimer = window.setTimeout(() => {
        if (!cancelled) controls = animate(ty, 0, { type: 'spring', stiffness: 340, damping: 24 })
      }, 50)
    }
    return () => {
      cancelled = true
      window.clearTimeout(riseTimer)
      controls?.stop()
    }
  }, [mode, ty])

  // the bin takes a file in: a squash and a bounce, and it stays out a little before tucking away
  useEffect(
    () =>
      window.dock.onLanded(() => {
        if (squash.current) {
          void animate(
            squash.current,
            { scale: [1, 1.2, 0.92, 1.04, 1] },
            { duration: 0.5, ease: 'easeOut' }
          )
        }
        setLinger(true)
        window.clearTimeout(lingerTimer.current)
        lingerTimer.current = window.setTimeout(() => setLinger(false), LINGER_MS)
      }),
    []
  )
  useEffect(
    () => () => {
      window.clearTimeout(lingerTimer.current)
      window.clearTimeout(leave.current)
    },
    []
  )

  const running = list.filter(active)
  const total = running.reduce((n, d) => n + d.total, 0)
  const got = running.reduce((n, d) => n + d.received, 0)
  const fill = running.length > 0 ? (total > 0 ? Math.max(0.12, got / total) : 0.3) : 0
  const peeking = list.filter((d) => d.state !== 'cancelled').slice(0, 3)

  return (
    <div
      className="dk-root"
      onPointerEnter={() => {
        window.clearTimeout(leave.current)
        setPointer(true)
      }}
      onPointerLeave={() => {
        window.clearTimeout(leave.current)
        leave.current = window.setTimeout(() => setPointer(false), 500)
      }}
    >
      <motion.div
        className="dk-tile"
        style={{ y: ty, right: MARGIN_R, bottom: MARGIN_B, width: BIN, height: BIN }}
      >
        <div ref={squash} className="dk-squash">
          <button
            type="button"
            className={
              'dk-bin' + (running.length > 0 ? ' busy' : '') + (overlay.open ? ' open' : '')
            }
            title="Downloads (Ctrl+J)"
            aria-label="Downloads"
            aria-haspopup="dialog"
            aria-expanded={overlay.open}
            onClick={() => window.dock.toggle()}
          >
            <Bucket peeking={peeking} fill={fill} />
          </button>
        </div>
      </motion.div>
    </div>
  )
}

/** The fan, and the file flying to the bin: a window-sized view, shown only while there is one or the other. */
function Fan(): React.JSX.Element {
  const list = useDownloads()
  const [open, setOpen] = useState(false)
  const [flights, setFlights] = useState<Flight[]>([])
  const [pending, setPending] = useState<DownloadStart[]>([])
  const nextKey = useRef(0)

  const busy = open || flights.length > 0 || pending.length > 0
  useEffect(() => window.dock.report({ open, active: busy }), [open, busy])
  useEffect(() => window.dock.onToggle(() => setOpen((o) => !o)), [])

  // a new download: the file flies from where the pointer was to the bin
  useEffect(() => window.dock.onStart((s) => setPending((p) => [...p, s])), [])
  useEffect(() => {
    if (pending.length === 0) return
    const to = binCentre()
    setFlights((f) => [
      ...f,
      ...pending.map((s) => ({
        key: nextKey.current++,
        from: s.at ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 },
        to,
        name: s.download.filename
      }))
    ])
    setPending([])
  }, [pending])

  const landed = useCallback((key: number) => {
    setFlights((f) => f.filter((x) => x.key !== key))
    window.dock.landed()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const rows = list.slice(0, FAN_MAX)

  return (
    <div className="dk-root">
      {open && <div className="dk-scrim" onClick={() => setOpen(false)} />}

      {flights.map((f) => (
        <motion.div
          key={f.key}
          className="dk-ghost"
          initial={{ x: f.from.x - 20, y: f.from.y - 24, opacity: 0, scale: 1 }}
          animate={path(f)}
          transition={{ duration: FLIGHT_S, ease: 'linear' }}
          onAnimationComplete={() => landed(f.key)}
        >
          <b>{extOf(f.name).slice(0, 4)}</b>
        </motion.div>
      ))}

      <AnimatePresence>
        {open && (
          <div
            key="fan"
            className="dk-fan"
            style={{ right: INSET + MARGIN_R + BIN / 2, bottom: MARGIN_B + BIN / 2 }}
            role="dialog"
            aria-label="Recent downloads"
          >
            {rows.map((d, i) => (
              <FanRow key={d.id} d={d} index={i} onDone={() => setOpen(false)} />
            ))}
            <FanRow
              key="all"
              index={rows.length}
              onDone={() => setOpen(false)}
              all
              empty={list.length === 0}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

const BOX_FRONT = 'M6 22 H46 L43 46.5 Q42.8 48.5 40.8 48.5 H11.2 Q9.2 48.5 9 46.5 Z'

/**
 * The box: an open cardboard box. The back flaps and the dark inside sit behind the last downloads standing up in it (so
 * the sliver that shows while it is tucked away shows them); the front face and its folded-down flap sit in front, and
 * a band of the accent colour rises up the face with the progress of whatever is downloading.
 */
function Bucket({ peeking, fill }: { peeking: DownloadInfo[]; fill: number }): React.JSX.Element {
  return (
    <>
      <svg className="dk-back" viewBox="0 0 52 52" aria-hidden="true">
        <path d="M10 14 L6 22 L1 19 L4 11 Z" className="dk-flap-side" />
        <path d="M42 14 L46 22 L51 19 L48 11 Z" className="dk-flap-side" />
        <path d="M11 14 H41 L39 6 H13 Z" className="dk-flap-back" />
        <path d="M10 14 H42 L46 22 H6 Z" className="dk-mouth" />
      </svg>
      <span className="dk-cards" aria-hidden="true">
        {peeking.map((d, i) => (
          <span
            key={d.id}
            className={'dk-card c' + i}
            style={d.preview ? { backgroundImage: `url(${d.preview})` } : undefined}
          >
            {d.preview ? null : <i>{extOf(d.filename).slice(0, 3)}</i>}
          </span>
        ))}
      </span>
      <svg className="dk-front" viewBox="0 0 52 52" aria-hidden="true">
        <defs>
          <linearGradient id="dk-wall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="dk-wall-top" />
            <stop offset="1" className="dk-wall-bottom" />
          </linearGradient>
          <clipPath id="dk-clip">
            <path d={BOX_FRONT} />
          </clipPath>
        </defs>
        <path d={BOX_FRONT} fill="url(#dk-wall)" />
        <rect
          x="4"
          width="44"
          height="30"
          y={48.5 - 26 * fill}
          clipPath="url(#dk-clip)"
          className="dk-level"
        />
        <rect x="19" y="35" width="14" height="3.6" rx="1.8" className="dk-hole" />
        <path d="M4.5 22 H47.5 L45.6 30.5 H6.4 Z" className="dk-flap-front" />
        <path d="M6.4 30.5 H45.6" className="dk-crease" fill="none" />
      </svg>
    </>
  )
}

function FanRow({
  d,
  index,
  onDone,
  all = false,
  empty = false
}: {
  d?: DownloadInfo
  index: number
  onDone: () => void
  all?: boolean
  empty?: boolean
}): React.JSX.Element {
  // each row sits a little further round a curve than the one before it, like the stack's fan; the bin is at the
  // window's right edge, so the fan reaches to the left of it and bends that way
  const y = -(index + 1) * (ROW_H + FAN_GAP)
  const x = -(index * index * 2.2 + 6)
  const pct = d && d.total > 0 ? Math.min(1, d.received / d.total) : 0
  return (
    <motion.div
      className={'dk-row' + (all ? ' all' : '')}
      style={{ transformOrigin: 'right bottom' }}
      initial={{ x: 0, y: 0, scale: 0.4, opacity: 0, rotate: 0 }}
      animate={{
        x,
        y,
        scale: 1,
        opacity: 1,
        rotate: index * 0.9,
        transition: { type: 'spring', stiffness: 380, damping: 30, delay: index * 0.025 }
      }}
      exit={{ x: 0, y: 0, scale: 0.4, opacity: 0, transition: { duration: 0.14 } }}
    >
      {all || !d ? (
        <button
          type="button"
          className="dk-row-main"
          onClick={() => {
            window.dock.openDownloads()
            onDone()
          }}
        >
          <span className="dk-row-title">{empty ? 'No downloads yet' : 'Show all downloads'}</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            className="dk-row-main"
            disabled={d.state !== 'completed'}
            onClick={() => {
              window.dock.act(d.id, 'open')
              onDone()
            }}
          >
            <Face d={d} size={34} />
            <span className="dk-row-text">
              <span className="dk-row-title">{d.filename}</span>
              <span className="dk-row-meta">
                {d.state === 'completed'
                  ? formatBytes(d.total || d.received)
                  : d.state === 'progressing'
                    ? `${formatBytes(d.received)}${d.total ? ` of ${formatBytes(d.total)}` : ''}`
                    : d.state === 'paused'
                      ? 'Paused'
                      : d.state === 'cancelled'
                        ? 'Cancelled'
                        : 'Interrupted'}
              </span>
            </span>
          </button>
          <span className="dk-row-acts">
            {d.state === 'completed' && (
              <button
                type="button"
                title="Show in folder"
                aria-label="Show in folder"
                onClick={() => window.dock.act(d.id, 'show')}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.6h5A1.5 1.5 0 0 1 14 6.1v5.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
                </svg>
              </button>
            )}
            <button
              type="button"
              title={active(d) ? 'Cancel' : 'Remove from list'}
              aria-label={active(d) ? 'Cancel download' : 'Remove from list'}
              onClick={() => window.dock.act(d.id, active(d) ? 'cancel' : 'remove')}
            >
              <CloseIcon />
            </button>
          </span>
          {active(d) && (
            <span className="dk-row-bar" style={{ transform: `scaleX(${pct || 0.05})` }} />
          )}
        </>
      )}
    </motion.div>
  )
}
