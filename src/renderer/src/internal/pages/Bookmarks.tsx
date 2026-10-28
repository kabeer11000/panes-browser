import { useEffect, useState } from 'react'
import type { Bookmark } from '../../../../shared/types'
import { CloseIcon, SearchIcon } from '../../components/icons'
import { host } from '../format'
import { Site } from '../Site'

export function Bookmarks(): React.JSX.Element {
  const [items, setItems] = useState<Bookmark[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    void window.panesInternal.bookmarksList().then(setItems)
  }, [])

  const remove = async (id: number): Promise<void> => {
    await window.panesInternal.bookmarkRemove(id)
    setItems((prev) => prev.filter((b) => b.id !== id))
  }

  const q = query.trim().toLowerCase()
  const shown = q
    ? items.filter((b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
    : items

  return (
    <>
      <div className="int-toolbar">
        <label className="int-search">
          <SearchIcon />
          <input
            autoFocus
            placeholder="Search bookmarks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {shown.length === 0 && (
        <p className="int-empty">
          {query
            ? 'No matching bookmarks.'
            : 'No bookmarks yet. Press Ctrl+D on any page to add one.'}
        </p>
      )}

      <div className="int-cards">
        {shown.map((b) => (
          <div key={b.id} className="int-card">
            <a className="int-card-link" href={b.url}>
              <Site favicon={b.favicon} title={b.title} url={b.url} />
              <span className="int-title">{b.title}</span>
              <span className="int-sub">{host(b.url)}</span>
            </a>
            <button
              className="int-icon corner"
              title="Remove bookmark"
              onClick={() => void remove(b.id)}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
