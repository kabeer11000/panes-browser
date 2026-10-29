import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { StackEntry } from '../../../shared/stack'
import type { TabInfo } from '../../../shared/types'
import { useGridDrag } from '../hooks/useGridDrag'
import { tabTitle } from '../tabTitle'
import { CardThumb } from './CardThumb'
import { entryTitle, pageAspect } from './cardUtils'
import { CloseIcon, PlusIcon, SearchIcon, SplitIcon } from './icons'
import { TabFavicon } from './TabFavicon'

interface Props {
  entries: StackEntry[]
  /** Tab order, used to turn a card position into a tab-list index when reordering. */
  tabs: TabInfo[]
  activeId: number | null
  thumbs: Record<number, string>
  onPick: (id: number) => void
  onNew: () => void
  onClose: () => void
}

const spring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const

const matches = (e: StackEntry, q: string): boolean =>
  e.tabs.some((t) => `${tabTitle(t)} ${t.url}`.toLowerCase().includes(q))

/** Index of the card nearest to `from` in the row above (-1) or below (+1), by on-screen position. */
function verticalNeighbour(cards: HTMLElement[], from: number, dir: 1 | -1): number {
  const cur = cards[from]
  if (!cur) return from
  const rows = cards
    .map((el, i) => ({ i, top: el.offsetTop, left: el.offsetLeft }))
    .filter((c) => (dir > 0 ? c.top > cur.offsetTop + 4 : c.top < cur.offsetTop - 4))
  if (rows.length === 0) return from
  const nearestTop = rows.reduce(
    (best, c) => (Math.abs(c.top - cur.offsetTop) < Math.abs(best - cur.offsetTop) ? c.top : best),
    rows[0].top
  )
  return rows
    .filter((c) => c.top === nearestTop)
    .reduce((best, c) =>
      Math.abs(c.left - cur.offsetLeft) < Math.abs(best.left - cur.offsetLeft) ? c : best
    ).i
}

export function TaskView({
  entries,
  tabs,
  activeId,
  thumbs,
  onPick,
  onNew,
  onClose
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [aspect] = useState(pageAspect)
  const gridRef = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()
  const shown = q ? entries.filter((e) => matches(e, q)) : entries
  const [rawSel, setSel] = useState(() =>
    Math.max(
      0,
      entries.findIndex((e) => e.tabs.some((t) => t.id === activeId))
    )
  )
  const sel = Math.min(rawSel, Math.max(0, shown.length - 1))
  const selected: StackEntry | undefined = shown[sel]

  const { drag, start } = useGridDrag(shown, tabs, (e) => onPick(e.primaryId))

  useEffect(() => {
    const cards = gridRef.current?.querySelectorAll<HTMLElement>('.grid-card[data-key]')
    cards?.[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel, q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const cards = [
        ...(gridRef.current?.querySelectorAll<HTMLElement>('.grid-card[data-key]') ?? [])
      ]
      const last = Math.max(0, cards.length - 1)
      if (e.key === 'Escape') {
        if (query) setQuery('')
        else onClose()
      } else if (e.key === 'Enter' && selected) {
        // Shift+Enter tiles the selected tab beside the one you are on, no dragging needed.
        if (e.shiftKey && selected.tabs.length === 1 && selected.primaryId !== activeId) {
          window.api.splitWith(selected.primaryId)
          onClose()
        } else {
          onPick(selected.primaryId)
        }
      } else if (e.key === 'ArrowRight') setSel(Math.min(last, sel + 1))
      else if (e.key === 'ArrowLeft') setSel(Math.max(0, sel - 1))
      else if (e.key === 'ArrowDown') setSel(verticalNeighbour(cards, sel, 1))
      else if (e.key === 'ArrowUp') setSel(verticalNeighbour(cards, sel, -1))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [query, selected, sel, activeId, onClose, onPick])

  return (
    <motion.div
      className="taskview"
      style={{ '--stack-aspect': aspect } as React.CSSProperties}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="ov-head">
        <label className="ov-search">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            placeholder={`Search ${tabs.length} tab${tabs.length === 1 ? '' : 's'}`}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              setSel(0)
            }}
          />
        </label>
        <div className="ov-hints">
          <kbd>Enter</kbd> open <kbd>Shift+Enter</kbd> split with current <kbd>Esc</kbd> close
        </div>
      </div>

      <div
        ref={gridRef}
        className={'taskview-grid' + (drag ? ' dragging' : '')}
        onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      >
        {shown.length === 0 && <p className="ov-empty">No tabs match.</p>}
        {shown.map((entry, i) => {
          const isGroup = entry.tabs.length > 1
          const over = drag?.over?.key === entry.key ? drag.over : null
          const cls =
            'grid-card' +
            (entry.tabs.some((t) => t.id === activeId) ? ' active' : '') +
            (i === sel ? ' selected' : '') +
            (drag?.entry.key === entry.key ? ' lifted' : '') +
            (over ? (over.after ? ' ins-after' : ' ins-before') : '')
          return (
            <motion.div
              key={entry.key}
              data-key={entry.key}
              className={cls}
              layout={!drag}
              initial={{ opacity: 0, scale: 0.92, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ ...spring, delay: Math.min(i * 0.02, 0.2) }}
              whileHover={drag ? undefined : { y: -3 }}
              onPointerDown={(e) => start(e, entry)}
              onMouseEnter={() => !drag && setSel(i)}
            >
              <div className="card-head">
                {isGroup ? (
                  <span className="card-favicons">
                    {entry.tabs.slice(0, 3).map((t) => (
                      <TabFavicon key={t.id} tab={t} />
                    ))}
                  </span>
                ) : (
                  <TabFavicon tab={entry.tabs[0]} />
                )}
                <span className="tab-title">{entryTitle(entry)}</span>
                {isGroup && <span className="group-badge">Split {entry.tabs.length}</span>}
                {entry.tabs.some((t) => t.id === activeId) && (
                  <span className="current-chip">Current</span>
                )}
                {!isGroup && entry.primaryId !== activeId && (
                  <button
                    className="card-btn"
                    title="Open beside current tab"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      window.api.splitWith(entry.primaryId)
                      onClose()
                    }}
                  >
                    <SplitIcon />
                  </button>
                )}
                <button
                  className="card-btn"
                  title={isGroup ? 'Ungroup (tabs stay open)' : 'Close tab'}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() =>
                    isGroup
                      ? window.api.unsplit(entry.primaryId)
                      : window.api.closeTab(entry.primaryId)
                  }
                >
                  <CloseIcon />
                </button>
              </div>
              <div className="card-thumb">
                <CardThumb entry={entry} thumbs={thumbs} />
              </div>
            </motion.div>
          )
        })}
        {!q && (
          <motion.button
            className="grid-card new-card"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={spring}
            onClick={onNew}
          >
            <PlusIcon />
            <span>New tab</span>
          </motion.button>
        )}
      </div>

      {drag && (
        <div
          className="drag-ghost"
          style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 10}px)` }}
        >
          <TabFavicon tab={drag.entry.tabs[0]} />
          <span className="tab-title">{entryTitle(drag.entry)}</span>
        </div>
      )}
    </motion.div>
  )
}
