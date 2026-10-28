import { motion } from 'motion/react'
import { useEffect } from 'react'
import type { TabInfo } from '../../../shared/types'
import { CloseIcon, PlusIcon } from './icons'
import { tabTitle } from '../tabTitle'
import { TabFavicon } from './TabFavicon'

interface Props {
  tabs: TabInfo[]
  activeId: number | null
  thumbs: Record<number, string>
  onPick: (id: number) => void
  onNew: () => void
  onClose: () => void
}

const spring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const

export function TaskView({
  tabs,
  activeId,
  thumbs,
  onPick,
  onNew,
  onClose
}: Props): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      className="taskview"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="taskview-grid"
        onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      >
        {tabs.map((t, i) => (
          <motion.div
            key={t.id}
            className={'card' + (t.id === activeId ? ' active' : '')}
            initial={{ opacity: 0, scale: 0.9, y: 28 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ ...spring, delay: Math.min(i * 0.025, 0.2) }}
            whileHover={{ y: -4 }}
            onClick={() => onPick(t.id)}
          >
            <div className="card-head">
              <TabFavicon tab={t} />
              <span className="tab-title">{tabTitle(t)}</span>
              <button
                className="tab-close visible"
                onClick={(e) => {
                  e.stopPropagation()
                  window.api.closeTab(t.id)
                }}
              >
                <CloseIcon />
              </button>
            </div>
            <div className="card-thumb">
              {thumbs[t.id] ? (
                <img src={thumbs[t.id]} alt="" draggable={false} />
              ) : (
                <span>New tab</span>
              )}
            </div>
          </motion.div>
        ))}
        <motion.button
          className="card new-card"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={spring}
          onClick={onNew}
        >
          <PlusIcon />
          <span>New tab</span>
        </motion.button>
      </div>
    </motion.div>
  )
}
