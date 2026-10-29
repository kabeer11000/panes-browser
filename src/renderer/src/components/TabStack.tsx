import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue
} from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StackEntry } from '../../../shared/stack'
import { displayHost } from '../../../shared/url'
import { useEdgeColor, useGlow } from '../ambient'
import { CardFavicons, CardMarks } from './CardMarks'
import { CardThumb } from './CardThumb'
import { entryTitle, pageAspect } from './cardUtils'
import { ChevronIcon, CloseIcon } from './icons'

// Depth feel. d = card index - scroll position: 0 is front. Upcoming cards (d>0) recede down and back
// (same order as the sidebar and rail), earlier cards (d<0) recede up and back.
const STEP_Z = 220
const STEP_Y = 78
// the side strip is flat: cards one below the other, a card's height and a small gap apart, so none covers another
const SIDE_WIDTH = 232 // the strip (see .stack.side), less the 14px of margin each side of a card
const SIDE_HEAD = 28
const SIDE_GAP = 32 // room for the tilt: a turned card's corners reach past its edge
// the strip's cards sit on a very large wheel (radius in px): level at the front, curving away and tilting a little
const SIDE_RADIUS = 2200
const SIDE_VISIBLE = 6 // cards either side of the front one that are drawn; the strip's edges hide the rest
const FADE = 0.26
const DIM_PER_STEP = 0.16
const DIM_MAX = 0.55
// Cards are fully faded (opacity 0) about 4 cards from the front, so those further out are not rendered at all.
const VISIBLE = Math.ceil(1 / FADE)
const RAIL_ITEM_H = 44
const PAGE_JUMP = 4

interface Props {
  /** A strip down the right edge, beside the page, instead of the whole page area. */
  side?: boolean
  entries: StackEntry[]
  activeId: number | null
  thumbs: Record<number, string>
  /** Scroll position in cards (float). Owned by App so wheel events can arrive before mount. */
  target: MotionValue<number>
  onStep: (delta: number) => void
  onJump: (index: number) => void
  onCommit: () => void
  onCancel: () => void
  /** Close the tab, or every tab of the split, that a card stands for. */
  onCloseEntry: (entry: StackEntry) => void
}

const holds = (e: StackEntry, id: number | null): boolean => e.tabs.some((t) => t.id === id)

export function TabStack({
  side = false,
  entries,
  activeId,
  thumbs,
  target,
  onStep,
  onJump,
  onCommit,
  onCancel,
  onCloseEntry
}: Props): React.JSX.Element {
  const reduced = useReducedMotion()
  const spring = useSpring(target, { stiffness: 320, damping: 38, mass: 1 })
  const pos = reduced ? target : spring
  const last = entries.length - 1
  const [index, setIndex] = useState(() => Math.round(target.get()))
  const [aspect] = useState(pageAspect)
  useMotionValueEvent(target, 'change', (v) => setIndex(Math.min(last, Math.max(0, Math.round(v)))))
  // Which card the spring is passing, as a whole number: state only changes when it crosses one, so scrolling
  // re-renders once per card, and only the cards around it exist.
  const [near, setNear] = useState(() => Math.round(pos.get()))
  useMotionValueEvent(pos, 'change', (v) => setNear(Math.round(v)))

  // The way around is shown, not explained: arrows and a close button appear when the view opens and whenever the
  // pointer moves, and fade away once it rests, so the cards have the room the rest of the time.
  const [awake, setAwake] = useState(true)
  const idle = useRef<number | undefined>(undefined)
  const rest = useCallback((): void => {
    window.clearTimeout(idle.current)
    idle.current = window.setTimeout(() => setAwake(false), 2400)
  }, [])
  const wake = useCallback((): void => {
    setAwake(true)
    rest()
  }, [rest])
  useEffect(() => {
    rest()
    return () => window.clearTimeout(idle.current)
  }, [rest])

  // The deck fans open from a single pile when the view appears.
  const spread = useMotionValue(reduced ? 1 : 0)
  useEffect(() => {
    if (reduced) return
    const controls = animate(spread, 1, { type: 'spring', stiffness: 200, damping: 32 })
    return () => controls.stop()
  }, [spread, reduced])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') onCommit()
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        const entry = entries[Math.min(index, last)]
        if (entry) onCloseEntry(entry)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') onStep(1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') onStep(-1)
      else if (e.key === 'PageDown') onStep(PAGE_JUMP)
      else if (e.key === 'PageUp') onStep(-PAGE_JUMP)
      else if (e.key === 'Home') onJump(0)
      else if (e.key === 'End') onJump(last)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onCommit, onStep, onJump, onCloseEntry, entries, index, last])

  const current = entries[Math.min(index, last)]
  // Closing the last card leaves the scroll position past the end: pull it back.
  useEffect(() => {
    if (last >= 0 && target.get() > last) target.set(last)
  }, [last, target])
  const glow = useGlow(current ? thumbs[current.primaryId] : undefined)
  // the strip's shade takes the colour of the page it lies over (the tab on screen), so it blends in with it
  const shade = useEdgeColor(side && activeId !== null ? thumbs[activeId] : undefined)

  return (
    <motion.div
      className={'stack' + (side ? ' side' : '') + (awake ? ' awake' : '')}
      onPointerMove={wake}
      role="listbox"
      aria-label="Open tabs"
      style={
        {
          '--stack-aspect': aspect,
          '--glow': glow,
          '--shade': shade ?? 'var(--overlay-solid)'
        } as React.CSSProperties
      }
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={side ? { opacity: 0 } : { opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      {!side && <div className="stack-ambient" aria-hidden="true" />}
      {!side && (
        <button
          type="button"
          tabIndex={-1}
          className="stack-exit"
          title="Stay on this tab (Esc)"
          aria-label="Close pane view"
          onClick={onCancel}
        >
          <CloseIcon />
        </button>
      )}
      {!side && (
        <div className="stack-nav">
          <button
            type="button"
            tabIndex={-1}
            className="stack-nav-btn up"
            title="Previous tab"
            aria-label="Previous tab"
            disabled={index <= 0}
            onClick={() => onStep(-1)}
          >
            <ChevronIcon />
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="stack-nav-btn"
            title="Next tab"
            aria-label="Next tab"
            disabled={index >= last}
            onClick={() => onStep(1)}
          >
            <ChevronIcon />
          </button>
        </div>
      )}
      {!side && (
        <TimelineRail
          entries={entries}
          activeId={activeId}
          pos={pos}
          index={index}
          onJump={onJump}
        />
      )}
      <div className="stack-scene">
        {entries.map((e, i) =>
          Math.abs(i - near) > (side ? SIDE_VISIBLE : VISIBLE) ? null : (
            <StackCard
              key={e.key}
              entry={e}
              current={holds(e, activeId)}
              thumbs={thumbs}
              index={i}
              selected={i === index}
              pos={pos}
              spread={spread}
              stepY={side ? Math.round(SIDE_HEAD + (SIDE_WIDTH - 28) / aspect + SIDE_GAP) : STEP_Y}
              flat={side}
              onClick={() => (i === index ? onCommit() : onJump(i))}
              onClose={() => onCloseEntry(e)}
            />
          )
        )}
      </div>
      {current && !side && (
        <div className="stack-label">
          <div className="stack-title">{entryTitle(current)}</div>
          {current.tabs.length === 1 && (
            <div className="stack-meta">{displayHost(current.tabs[0].url) || 'New tab'}</div>
          )}
          <div className="sr-only" aria-live="polite">
            {entryTitle(current)}, {index + 1} of {entries.length}
          </div>
        </div>
      )}
    </motion.div>
  )
}

function StackCard({
  entry,
  current,
  thumbs,
  index,
  selected,
  pos,
  spread,
  stepY,
  flat,
  onClick,
  onClose
}: {
  entry: StackEntry
  current: boolean
  thumbs: Record<number, string>
  index: number
  selected: boolean
  pos: MotionValue<number>
  spread: MotionValue<number>
  /** Pixels between one card and the next. */
  stepY: number
  /** The side strip: no depth in z; cards ride a very large wheel instead and stay full size and solid. */
  flat: boolean
  onClick: () => void
  onClose: () => void
}): React.JSX.Element {
  const stepZ = flat ? 0 : STEP_Z
  const d = useTransform(pos, (p) => index - p)
  const z = useTransform([d, spread], ([v, s]: number[]) => -Math.abs(v) * stepZ * s)
  // Along the wheel: `angle` is how far round this card is from the front. Not flat: a straight line, down the screen.
  const angle = (v: number, s: number): number => (v * stepY * s) / SIDE_RADIUS
  const y = useTransform([d, spread], ([v, s]: number[]) =>
    flat ? SIDE_RADIUS * Math.sin(angle(v, s)) : v * stepY * s
  )
  const x = useTransform([d, spread], ([v, s]: number[]) =>
    flat ? SIDE_RADIUS * (1 - Math.cos(angle(v, s))) : 0
  )
  const rotate = useTransform([d, spread], ([v, s]: number[]) =>
    flat ? (-angle(v, s) * 180) / Math.PI : 0
  )
  // a flat strip keeps its cards solid: the shade at its edges does the fading, not the cards' own opacity
  const opacity = useTransform(d, (v) => (flat ? 1 : Math.max(0, 1 - Math.abs(v) * FADE)))
  // Things further from the front darken. A dim layer fades on the compositor; a per-frame blur filter did not.
  const dim = useTransform(d, (v) =>
    flat ? Math.min(0.18, Math.abs(v) * 0.05) : Math.min(DIM_MAX, Math.abs(v) * DIM_PER_STEP)
  )
  const isGroup = entry.tabs.length > 1

  return (
    <motion.div
      className={'stack-card' + (selected ? ' front' : '')}
      role="option"
      aria-selected={selected}
      aria-label={entryTitle(entry)}
      style={{ z, x, y, rotate, opacity }}
      onClick={onClick}
    >
      <div className="card-head">
        <CardFavicons entry={entry} />
        <span className="tab-title">{entryTitle(entry)}</span>
        <CardMarks entry={entry} current={current} />
        <button
          type="button"
          tabIndex={-1}
          className="card-btn stack-close"
          title={isGroup ? 'Close split (every tab in it)' : 'Close tab'}
          aria-label={isGroup ? 'Close split' : 'Close tab'}
          onClick={(e) => {
            e.stopPropagation() // closing is not choosing
            onClose()
          }}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="card-thumb">
        <CardThumb entry={entry} thumbs={thumbs} />
      </div>
      <motion.div className="card-dim" style={{ opacity: dim }} aria-hidden="true" />
    </motion.div>
  )
}

/** Vertical thread of card names; the current card sits at the vertical center and neighbours are readable. */
function TimelineRail({
  entries,
  activeId,
  pos,
  index,
  onJump
}: {
  entries: StackEntry[]
  activeId: number | null
  pos: MotionValue<number>
  index: number
  onJump: (index: number) => void
}): React.JSX.Element {
  const y = useTransform(pos, (p) => -p * RAIL_ITEM_H)
  return (
    <div className="rail" aria-hidden="true">
      <motion.div className="rail-track" style={{ y }}>
        <span
          className="rail-line"
          style={{ height: Math.max(0, entries.length - 1) * RAIL_ITEM_H }}
        />
        {entries.map((e, i) => (
          <RailItem
            key={e.key}
            entry={e}
            current={holds(e, activeId)}
            index={i}
            pos={pos}
            active={i === index}
            onClick={() => onJump(i)}
          />
        ))}
      </motion.div>
    </div>
  )
}

function RailItem({
  entry,
  current,
  index,
  pos,
  active,
  onClick
}: {
  entry: StackEntry
  current: boolean
  index: number
  pos: MotionValue<number>
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const opacity = useTransform(pos, (p) => Math.max(0.28, 1 - Math.abs(index - p) * 0.2))
  const dotScale = useTransform(pos, (p) => 1 + Math.max(0, 1 - Math.abs(index - p)) * 0.7)
  return (
    <motion.button
      type="button"
      tabIndex={-1}
      className={'rail-item' + (active ? ' active' : '') + (current ? ' current' : '')}
      style={{ opacity, height: RAIL_ITEM_H }}
      onClick={onClick}
    >
      <motion.span className="rail-dot" style={{ scale: dotScale }} />
      <CardFavicons entry={entry} />
      <span className="rail-title">{entryTitle(entry)}</span>
    </motion.button>
  )
}
