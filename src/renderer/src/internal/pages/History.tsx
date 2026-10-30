import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import {
  BULK_OPEN_MAX,
  NONE,
  all,
  bulkOpenList,
  click,
  type Selection
} from '../../../../shared/selection'
import type { HistoryEntry } from '../../../../shared/types'
import { CloseIcon, HistoryIcon, SearchIcon } from '../../components/icons'
import { dayLabel, formatTime, host } from '../format'
import { Site } from '../Site'
import { EmptyState } from '../ui'

const PAGE = 120

export function History(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [more, setMore] = useState(false)
  const [sel, setSel] = useState<Selection>(NONE)

  const load = useCallback(async (q: string, offset: number) => {
    const rows = await window.panesInternal.historyList(q, PAGE, offset)
    setEntries((prev) => (offset === 0 ? rows : [...prev, ...rows]))
    setMore(rows.length === PAGE)
  }, [])

  // Debounced so typing does not hammer the main process.
  useEffect(() => {
    const t = setTimeout(() => void load(query, 0), 150)
    return () => clearTimeout(t)
  }, [query, load])

  const remove = async (id: number): Promise<void> => {
    await window.panesInternal.historyRemove(id)
    setEntries((prev) => prev.filter((e) => e.id !== id))
    setSel((s) => ({ ...s, ids: new Set([...s.ids].filter((i) => i !== id)) }))
  }

  const order = entries.map((e) => e.id)
  const removeSelected = useCallback(async (): Promise<void> => {
    const ids = [...sel.ids]
    if (ids.length === 0) return
    await window.panesInternal.historyRemoveMany(ids)
    setEntries((prev) => prev.filter((e) => !sel.ids.has(e.id)))
    setSel(NONE)
  }, [sel.ids])

  // What opening the selection opens: the selected rows as listed, web pages only, each once, up to the limit.
  const openable = bulkOpenList(entries.filter((e) => sel.ids.has(e.id)))
  const openSelected = useCallback(async (): Promise<void> => {
    if (openable.length === 0) return
    await window.panesInternal.openMany(
      openable.map(({ url, title, favicon }) => ({ url, title, favicon }))
    )
    setSel(NONE)
  }, [openable])

  // Select with the keyboard like a file manager: Ctrl+A for everything shown, Esc to let go, Delete to remove.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = e.target instanceof Element && e.target.closest('input, textarea') !== null
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing) {
        e.preventDefault()
        setSel(all(entries.map((x) => x.id)))
      } else if (e.key === 'Escape' && sel.ids.size > 0) {
        setSel(NONE)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && sel.ids.size > 0) {
        e.preventDefault()
        void removeSelected()
      } else if (e.key === 'Enter' && !typing && openable.length > 0) {
        e.preventDefault()
        void openSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entries, sel.ids.size, removeSelected, openable.length, openSelected])

  const pick = (e: MouseEvent, id: number): void => {
    e.preventDefault()
    setSel((s) => click(s, order, id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }))
  }
  const selecting = sel.ids.size > 0

  const groups: Array<{ label: string; items: HistoryEntry[] }> = []
  for (const e of entries) {
    const label = dayLabel(e.time)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(e)
    else groups.push({ label, items: [e] })
  }

  return (
    <>
      <div className="int-toolbar">
        <label className="int-search">
          <SearchIcon />
          <input
            autoFocus
            placeholder="Search history"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <a className="int-btn" href="panes://settings#privacy">
          Clear data
        </a>
      </div>

      {selecting && (
        <div className="sel-bar" role="toolbar" aria-label="Selected history">
          <span>
            {sel.ids.size} selected
            {sel.ids.size < entries.length && (
              <button className="sel-link" onClick={() => setSel(all(order))}>
                Select all {entries.length}
              </button>
            )}
          </span>
          <span className="sel-actions">
            <button className="int-btn small" onClick={() => setSel(NONE)}>
              Clear selection
            </button>
            <button
              className="int-btn small"
              disabled={openable.length === 0}
              title={
                openable.length < sel.ids.size
                  ? `Opens ${openable.length} of the ${sel.ids.size} selected: web pages only, each once, at most ${BULK_OPEN_MAX}`
                  : 'Open the selected pages in new tabs (Enter)'
              }
              onClick={() => void openSelected()}
            >
              {openable.length === 1 ? 'Open in a new tab' : `Open ${openable.length} in new tabs`}
            </button>
            <button className="int-btn small danger" onClick={() => void removeSelected()}>
              Delete
            </button>
          </span>
        </div>
      )}

      {entries.length === 0 && (
        <EmptyState
          icon={<HistoryIcon />}
          title={query ? `No history matches "${query.trim()}"` : 'No history yet'}
        >
          {query
            ? 'Try another word, or part of the address.'
            : 'Pages you visit show up here, so you can find your way back to them.'}
        </EmptyState>
      )}

      {groups.map((g) => (
        <section key={g.label} className="int-day">
          <h2>{g.label}</h2>
          <div className="u-group">
            {g.items.map((e) => (
              <div
                key={e.id}
                className={'u-row int-item' + (sel.ids.has(e.id) ? ' selected' : '')}
                aria-selected={sel.ids.has(e.id)}
                // Ctrl or Shift on a row selects it instead of opening it; so does any click while rows are selected.
                onClickCapture={(ev) => {
                  if (selecting || ev.ctrlKey || ev.metaKey || ev.shiftKey) {
                    if ((ev.target as HTMLElement).closest('.int-icon, .int-check')) return
                    pick(ev, e.id)
                  }
                }}
              >
                <button
                  className={'int-check' + (sel.ids.has(e.id) ? ' on' : '')}
                  role="checkbox"
                  aria-checked={sel.ids.has(e.id)}
                  aria-label="Select"
                  onClick={(ev) => pick(ev, e.id)}
                >
                  {sel.ids.has(e.id) && (
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path d="m2.5 6.3 2.3 2.2 4.7-4.8" />
                    </svg>
                  )}
                </button>
                <Site favicon={e.favicon} title={e.title} url={e.url} />
                <a className="int-link" href={e.url}>
                  <span className="int-title">{e.title || e.url}</span>
                  <span className="int-sub">{host(e.url)}</span>
                </a>
                <span className="int-time">{formatTime(e.time)}</span>
                <button
                  className="int-icon"
                  title="Remove from history"
                  aria-label="Remove from history"
                  onClick={() => void remove(e.id)}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}

      {more && (
        <button className="int-btn" onClick={() => void load(query, entries.length)}>
          Load more
        </button>
      )}
    </>
  )
}
