import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DockApi, DockMode, DownloadInfo, DownloadStart } from '../../../shared/types'
import { formatBytes } from '../internal/format'
import { CloseIcon } from '../components/icons'

declare global {
  interface Window {
    dock: DockApi
  }
}

// Geometry, in step with the main process (see dock.ts): the view is SIZE square at the window's corner; the bin sits
// MARGIN in from the corner; tucked away only the top SLIVER of the view shows.
const SIZE = 104
const SLIVER = 34
const BIN = 68
const MARGIN = 16
const HIDE_Y = SIZE - SLIVER - (SIZE - MARGIN - BIN) // how far below its place the bin is, with the view at the edge
const PEEK_Y = -(SIZE - MARGIN - BIN) // and how far above it, when the view has dropped to the edge (it shows the top)
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

/**
 * The downloads bin. It lives off the window's bottom-right edge with a sliver of itself showing, so it is known to be
 * there. It comes out when the pointer rests in the corner, and when something starts downloading: the new file flies
 * to it from where the pointer was, the bin squashes round it and tucks away again. Clicking it fans the recent
 * downloads out above it, as the Downloads stack on a Mac does.
 */
export function Dock(): React.JSX.Element {
  const list = useDownloads()
  const [open, setOpen] = useState(false)
  const [pointer, setPointer] = useState(false)
  const [corner, setCorner] = useState(false)
  const [linger, setLinger] = useState(false)
  const [flights, setFlights] = useState<Flight[]>([])
  const [pending, setPending] = useState<DownloadStart[]>([])
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight })
  const ty = useMotionValue(PEEK_Y)
  const shown = useRef<DockMode>('peek') // what the main process has been told
  const leave = useRef<number | undefined>(undefined)
  const lingerTimer = useRef<number | undefined>(undefined)
  const nextKey = useRef(0)
  const squash = useRef<HTMLDivElement>(null)

  const busy = open || flights.length > 0 || pending.length > 0
  const mode: DockMode = busy ? 'full' : pointer || corner || linger ? 'out' : 'peek'

  useEffect(() => {
    const onResize = (): void => setWin({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => window.dock.onCorner(setCorner), [])
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

  // how much of the window the view covers, and the bin's slide in step with it
  useEffect(() => {
    let cancelled = false
    let controls: { stop: () => void } | null = null
    const was = shown.current
    if (mode === 'peek') {
      if (was === 'peek') return
      // slide down to the edge, then let the view drop to it too (the bin keeps its place on screen)
      controls = animate(ty, HIDE_Y, { type: 'spring', stiffness: 380, damping: 34 })
      void (controls as unknown as Promise<void>).then(() => {
        if (cancelled) return
        window.dock.setMode('peek')
        ty.set(PEEK_Y)
        shown.current = 'peek'
      })
    } else if (was === 'peek') {
      // the view rises to the bin's place; the bin starts where it was, at the edge, and slides up
      window.dock.setMode(mode)
      ty.set(HIDE_Y)
      shown.current = mode
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!cancelled) {
            controls = animate(ty, 0, { type: 'spring', stiffness: 340, damping: 24 })
          }
        })
      )
    } else {
      window.dock.setMode(mode)
      shown.current = mode
      controls = animate(ty, 0, { type: 'spring', stiffness: 340, damping: 24 })
    }
    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [mode, ty])

  // a new download: out comes the whole window's view, then the file flies from where the pointer was
  useEffect(() => window.dock.onStart((s) => setPending((p) => [...p, s])), [])
  useEffect(() => {
    if (pending.length === 0 || win.w < 300) return
    const to = { x: win.w - MARGIN - BIN / 2, y: win.h - MARGIN - BIN / 2 }
    setFlights((f) => [
      ...f,
      ...pending.map((s) => ({
        key: nextKey.current++,
        from: s.at ?? { x: win.w / 2, y: win.h / 2 },
        to,
        name: s.download.filename
      }))
    ])
    setPending([])
  }, [pending, win])

  const landed = useCallback((key: number) => {
    setFlights((f) => f.filter((x) => x.key !== key))
    // the bin takes it in: a squash and a bounce, and it stays out a little before tucking away
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
  }, [])
  useEffect(
    () => () => {
      window.clearTimeout(lingerTimer.current)
      window.clearTimeout(leave.current)
    },
    []
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const running = list.filter(active)
  const total = running.reduce((n, d) => n + d.total, 0)
  const got = running.reduce((n, d) => n + d.received, 0)
  const fill = running.length > 0 ? (total > 0 ? Math.max(0.12, got / total) : 0.3) : 0
  const peeking = list.filter((d) => d.state !== 'cancelled').slice(0, 3)
  const rows = list.slice(0, FAN_MAX)

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
      {open && <div className="dk-scrim" onClick={() => setOpen(false)} />}
      <motion.div
        className="dk-tile"
        style={{ y: ty, right: MARGIN, bottom: MARGIN, width: BIN, height: BIN }}
      >
        <div ref={squash} className="dk-squash">
          <button
            type="button"
            className={'dk-bin' + (running.length > 0 ? ' busy' : '') + (open ? ' open' : '')}
            title="Downloads (Ctrl+J)"
            aria-label="Downloads"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Bucket peeking={peeking} fill={fill} />
          </button>
        </div>
      </motion.div>

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
            style={{ left: win.w - MARGIN - BIN / 2, top: win.h - MARGIN - BIN / 2 }}
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

/**
 * The bucket: a back wall, the last downloads standing up out of it (so the sliver that shows while it is tucked away
 * shows them), and a front wall that rises with the progress of whatever is downloading.
 */
function Bucket({ peeking, fill }: { peeking: DownloadInfo[]; fill: number }): React.JSX.Element {
  return (
    <>
      <svg className="dk-back" viewBox="0 0 52 52" aria-hidden="true">
        <ellipse cx="26" cy="17" rx="20" ry="6" className="dk-mouth" />
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
            <path d="M6 17 A20 6 0 0 0 46 17 L42 45.5 Q41.4 49 37.5 49 H14.5 Q10.6 49 10 45.5 Z" />
          </clipPath>
        </defs>
        <path
          d="M6 17 A20 6 0 0 0 46 17 L42 45.5 Q41.4 49 37.5 49 H14.5 Q10.6 49 10 45.5 Z"
          fill="url(#dk-wall)"
        />
        <rect
          x="4"
          width="44"
          height="34"
          y={49 - 30 * fill}
          clipPath="url(#dk-clip)"
          className="dk-level"
        />
        <path d="M6 17 A20 6 0 0 0 46 17" className="dk-rim" fill="none" />
        <path d="M14 24 L16.4 43" className="dk-shine" fill="none" />
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
