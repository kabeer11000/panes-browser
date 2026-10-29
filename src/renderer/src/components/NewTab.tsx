import { useEffect, useState } from 'react'
import type { LocalSuggestion } from '../../../shared/search'
import { displayHost } from '../../../shared/url'
import { GlobeIcon, SearchIcon } from './icons'

const MAX_SITES = 8

/** The most-used sites, one per host, so the same site never fills several tiles. */
function pickSites(all: LocalSuggestion[]): LocalSuggestion[] {
  const seen = new Set<string>()
  const out: LocalSuggestion[] = []
  for (const s of all) {
    const host = displayHost(s.url)
    if (seen.has(host)) continue
    seen.add(host)
    out.push(s)
    if (out.length === MAX_SITES) break
  }
  return out
}

/** A blank tab: the search box, and the sites you go to most. Nothing else. */
export function NewTab({ onOpenSearch }: { onOpenSearch: () => void }): React.JSX.Element {
  const [sites, setSites] = useState<LocalSuggestion[]>([])

  useEffect(() => {
    let alive = true
    void window.api.suggestLocal('').then((r) => alive && setSites(pickSites(r)))
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="newtab">
      <div className="newtab-body">
        <button type="button" className="newtab-search" onClick={onOpenSearch}>
          <SearchIcon />
          <span>Search or enter address</span>
          <kbd>Ctrl L</kbd>
        </button>

        {sites.length > 0 && (
          <div className="newtab-sites">
            {sites.map((s) => (
              <button
                key={s.url}
                type="button"
                className="newtab-site"
                title={s.title}
                onClick={() => window.api.navigate(s.url)}
              >
                <span className="newtab-site-icon">
                  {s.favicon ? <img src={s.favicon} alt="" /> : <GlobeIcon />}
                </span>
                <span className="newtab-site-name">{displayHost(s.url)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
