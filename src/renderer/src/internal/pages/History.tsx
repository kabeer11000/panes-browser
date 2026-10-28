import { useCallback, useEffect, useState } from 'react'
import type { HistoryEntry } from '../../../../shared/types'
import { CloseIcon, SearchIcon } from '../../components/icons'
import { dayLabel, formatTime, host } from '../format'
import { Site } from '../Site'

const PAGE = 120

export function History(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [more, setMore] = useState(false)

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
  }

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
          Clear browsing data
        </a>
      </div>

      {entries.length === 0 && (
        <p className="int-empty">
          {query ? 'No matching history.' : 'No history yet. Pages you visit show up here.'}
        </p>
      )}

      {groups.map((g) => (
        <section key={g.label} className="int-group">
          <h2>{g.label}</h2>
          {g.items.map((e) => (
            <div key={e.id} className="int-row">
              <span className="int-time">{formatTime(e.time)}</span>
              <Site favicon={e.favicon} title={e.title} url={e.url} />
              <a className="int-link" href={e.url}>
                <span className="int-title">{e.title || e.url}</span>
                <span className="int-sub">{host(e.url)}</span>
              </a>
              <button
                className="int-icon"
                title="Remove from history"
                onClick={() => void remove(e.id)}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
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
