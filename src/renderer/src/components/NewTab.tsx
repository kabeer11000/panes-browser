import { useEffect, useState } from 'react'
import type { LocalSuggestion } from '../../../shared/search'
import { displayHost } from '../../../shared/url'
import { SearchIcon, ShieldIcon } from './icons'

const MAX_SITES = 8

/** The most-used sites, one per host, so the same site never fills several chips. */
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

/** A stable hue per site, so chips without a favicon still look distinct. */
const hueOf = (host: string): number => {
  let h = 0
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/** A blank tab: one big input that opens the command bar, and the sites you go to most. Nothing else. */
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

        <div className="newtab-private">
          <button type="button" onClick={() => window.api.newPrivateTab()}>
            <ShieldIcon />
            Private tab
          </button>
          <button type="button" onClick={() => window.api.newTorTab()}>
            <ShieldIcon />
            Tor tab
          </button>
        </div>

        {sites.length > 0 && (
          <div className="newtab-sites">
            {sites.map((s) => {
              const host = displayHost(s.url)
              return (
                <button
                  key={s.url}
                  type="button"
                  className="newtab-site"
                  title={s.title}
                  style={{ '--hue': hueOf(host) } as React.CSSProperties}
                  onClick={() => window.api.navigate(s.url)}
                >
                  {s.favicon ? (
                    <img src={s.favicon} alt="" />
                  ) : (
                    <b>{host.charAt(0).toUpperCase()}</b>
                  )}
                  <span>{host}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
