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
import { useEffect, useState } from 'react'
import type { StackEntry } from '../../../shared/stack'
import { displayHost } from '../../../shared/url'
import { useGlow } from '../ambient'
import { tabTitle } from '../tabTitle'
import { CardThumb } from './CardThumb'
import { entryTitle, pageAspect } from './cardUtils'
import { TabFavicon } from './TabFavicon'

// Depth feel. d = card index - scroll position: 0 is front. Upcoming cards (d>0) recede down and back
// (same order as the sidebar and rail), earlier cards (d<0) recede up and back.
const STEP_Z = 220
const STEP_Y = 78
const FADE = 0.26
const DIM_PER_STEP = 0.16
const DIM_MAX = 0.55
// Cards are fully faded (opacity 0) about 4 cards from the front, so those further out are not rendered at all.
const VISIBLE = Math.ceil(1 / FADE)
const RAIL_ITEM_H = 44
const PAGE_JUMP = 4

interface Props {
  entries: StackEntry[]
  activeId: number | null
  thumbs: Record<number, string>
  /** Scroll position in cards (float). Owned by App so wheel events can arrive before mount. */
  target: MotionValue<number>
  onStep: (delta: number) => void
  onJump: (index: number) => void
  onCommit: () => void
  onCancel: () => void
}

const holds = (e: StackEntry, id: number | null): boolean => e.tabs.some((t) => t.id === id)

/** Short rail label: a group reads as its first tab plus a count. */
const railLabel = (e: StackEntry): string =>
  e.tabs.length > 1 ? `${tabTitle(e.tabs[0])} +${e.tabs.length - 1}` : tabTitle(e.tabs[0])

export function TabStack({
  entries,
  activeId,
  thumbs,
  target,
  onStep,
  onJump,
  onCommit,
  onCancel
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
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') onStep(1)
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
  }, [onCancel, onCommit, onStep, onJump, last])

  const current = entries[Math.min(index, last)]
  const glow = useGlow(current ? thumbs[current.primaryId] : undefined)

  return (
    <motion.div
      className="stack"
      role="listbox"
      aria-label="Open tabs"
      style={{ '--stack-aspect': aspect, '--glow': glow } as React.CSSProperties}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="stack-ambient" aria-hidden="true" />
      <TimelineRail entries={entries} activeId={activeId} pos={pos} index={index} onJump={onJump} />
      <div className="stack-scene">
        {entries.map((e, i) =>
          Math.abs(i - near) > VISIBLE ? null : (
            <StackCard
              key={e.key}
              entry={e}
              current={holds(e, activeId)}
              thumbs={thumbs}
              index={i}
              selected={i === index}
              pos={pos}
              spread={spread}
              onClick={() => (i === index ? onCommit() : onJump(i))}
            />
          )
        )}
      </div>
      {current && (
        <div className="stack-label">
          <div className="stack-title">{entryTitle(current)}</div>
          <div className="stack-meta">
            <span>
              {current.tabs.length > 1
                ? `Split of ${current.tabs.length} tabs`
                : displayHost(current.tabs[0].url) || 'New tab'}
            </span>
            <span className="stack-count">
              {index + 1} of {entries.length}
            </span>
          </div>
          <div className="sr-only" aria-live="polite">
            {entryTitle(current)}, {index + 1} of {entries.length}
          </div>
        </div>
      )}
      <div className="stack-hints" aria-hidden="true">
        <span>
          <b>Release&nbsp;Ctrl</b> to open
        </span>
        <span>
          <b>Esc</b> to stay
        </span>
      </div>
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
  onClick
}: {
  entry: StackEntry
  current: boolean
  thumbs: Record<number, string>
  index: number
  selected: boolean
  pos: MotionValue<number>
  spread: MotionValue<number>
  onClick: () => void
}): React.JSX.Element {
  const d = useTransform(pos, (p) => index - p)
  const z = useTransform([d, spread], ([v, s]: number[]) => -Math.abs(v) * STEP_Z * s)
  const y = useTransform([d, spread], ([v, s]: number[]) => v * STEP_Y * s)
  const opacity = useTransform(d, (v) => Math.max(0, 1 - Math.abs(v) * FADE))
  // Things further from the front darken. A dim layer fades on the compositor; a per-frame blur filter did not.
  const dim = useTransform(d, (v) => Math.min(DIM_MAX, Math.abs(v) * DIM_PER_STEP))
  const isGroup = entry.tabs.length > 1
  const first = entry.tabs[0]

  return (
    <motion.div
      className={'stack-card' + (selected ? ' front' : '')}
      role="option"
      aria-selected={selected}
      aria-label={entryTitle(entry)}
      style={{ z, y, opacity }}
      onClick={onClick}
    >
      <div className="card-head">
        {isGroup ? (
          <span className="card-favicons">
            {entry.tabs.slice(0, 3).map((t) => (
              <TabFavicon key={t.id} tab={t} />
            ))}
          </span>
        ) : (
          <TabFavicon tab={first} />
        )}
        <span className="tab-title">{entryTitle(entry)}</span>
        {isGroup && <span className="group-badge">Split {entry.tabs.length}</span>}
        {current && <span className="current-chip">Current</span>}
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
      <TabFavicon tab={entry.tabs[0]} />
      <span className="rail-title">{railLabel(entry)}</span>
    </motion.button>
  )
}
