import {
  motion,
  useMotionValueEvent,
  useSpring,
  useTransform,
  type MotionValue
} from 'motion/react'
import { useEffect, useState } from 'react'
import type { TabInfo } from '../../../shared/types'
import { tabTitle } from '../tabTitle'
import { TabFavicon } from './TabFavicon'

// Depth feel. d = card index - scroll position: 0 is front. Upcoming tabs (d>0) recede down and back (same order as the sidebar and rail),
// earlier tabs (d<0) recede up and back, so neighbours on both sides stay visible.
const STEP_Z = 220
const STEP_Y = 78
const FADE = 0.26
const TILT = 0
const RAIL_ITEM_H = 44

interface Props {
  tabs: TabInfo[]
  thumbs: Record<number, string>
  /** Scroll position in cards (float). Owned by App so wheel events can arrive before mount. */
  target: MotionValue<number>
  onStep: (delta: 1 | -1) => void
  onJump: (index: number) => void
  onCommit: () => void
  onCancel: () => void
}

export function TabStack({
  tabs,
  thumbs,
  target,
  onStep,
  onJump,
  onCommit,
  onCancel
}: Props): React.JSX.Element {
  const pos = useSpring(target, { stiffness: 240, damping: 30, mass: 0.9 })
  const [index, setIndex] = useState(() => Math.round(target.get()))
  useMotionValueEvent(target, 'change', (v) => setIndex(Math.round(v)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') onCommit()
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') onStep(1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') onStep(-1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onCommit, onStep])

  const current = tabs[Math.min(index, tabs.length - 1)]

  return (
    <motion.div
      className="stack"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      <TimelineRail tabs={tabs} pos={pos} index={index} onJump={onJump} />
      <div className="stack-scene">
        {tabs.map((t, i) => (
          <StackCard
            key={t.id}
            tab={t}
            thumb={thumbs[t.id]}
            index={i}
            pos={pos}
            onClick={() => (i === index ? onCommit() : onJump(i))}
          />
        ))}
      </div>
      {current && (
        <div className="stack-label">
          <div className="stack-title">{tabTitle(current)}</div>
          <div className="stack-hint">
            {index + 1} / {tabs.length} &nbsp;·&nbsp; scroll to fly through, release Ctrl to open
          </div>
        </div>
      )}
    </motion.div>
  )
}

function StackCard({
  tab,
  thumb,
  index,
  pos,
  onClick
}: {
  tab: TabInfo
  thumb: string | undefined
  index: number
  pos: MotionValue<number>
  onClick: () => void
}): React.JSX.Element {
  const d = useTransform(pos, (p) => index - p)
  const z = useTransform(d, (v) => -Math.abs(v) * STEP_Z)
  const y = useTransform(d, (v) => v * STEP_Y)
  const opacity = useTransform(d, (v) => Math.max(0, 1 - Math.abs(v) * FADE))

  return (
    <motion.div className="stack-card" style={{ z, y, opacity, rotateX: TILT }} onClick={onClick}>
      <div className="card-head">
        <TabFavicon tab={tab} />
        <span className="tab-title">{tabTitle(tab)}</span>
      </div>
      <div className="card-thumb">
        {thumb ? <img src={thumb} alt="" draggable={false} /> : <span>New tab</span>}
      </div>
    </motion.div>
  )
}

/** Vertical thread of tab names; the current tab sits at the vertical center and neighbours are readable. */
function TimelineRail({
  tabs,
  pos,
  index,
  onJump
}: {
  tabs: TabInfo[]
  pos: MotionValue<number>
  index: number
  onJump: (index: number) => void
}): React.JSX.Element {
  const y = useTransform(pos, (p) => -p * RAIL_ITEM_H)
  return (
    <div className="rail">
      <motion.div className="rail-track" style={{ y }}>
        <span
          className="rail-line"
          style={{ height: Math.max(0, tabs.length - 1) * RAIL_ITEM_H }}
        />
        {tabs.map((t, i) => (
          <RailItem
            key={t.id}
            tab={t}
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
  tab,
  index,
  pos,
  active,
  onClick
}: {
  tab: TabInfo
  index: number
  pos: MotionValue<number>
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const opacity = useTransform(pos, (p) => Math.max(0.28, 1 - Math.abs(index - p) * 0.2))
  const dotScale = useTransform(pos, (p) => 1 + Math.max(0, 1 - Math.abs(index - p)) * 0.7)
  return (
    <motion.button
      className={'rail-item' + (active ? ' active' : '')}
      style={{ opacity, height: RAIL_ITEM_H }}
      onClick={onClick}
    >
      <motion.span className="rail-dot" style={{ scale: dotScale }} />
      <TabFavicon tab={tab} />
      <span className="rail-title">{tabTitle(tab)}</span>
    </motion.button>
  )
}
