import { useEffect, useRef, useState, type RefObject } from 'react'
import type { LocalSuggestion } from '../../../shared/search'
import { dailyPhotoId, nextPhotoId, photoUrl } from '../../../shared/photos'
import { displayHost } from '../../../shared/url'
import type { TabsState } from '../../../shared/types'
import { ImageIcon, SearchIcon, ShieldIcon } from './icons'

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

/** A site's tile: its icon, or its first letter when it has none or the icon will not load. */
function SiteTile({ favicon, host }: { favicon?: string; host: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  return (
    <span className="newtab-tile">
      {favicon && !failed ? (
        <img src={favicon} alt="" onError={() => setFailed(true)} />
      ) : (
        <b>{host.charAt(0).toUpperCase()}</b>
      )}
    </span>
  )
}

/** A stable hue per site, so chips without a favicon still look distinct. */
const hueOf = (host: string): number => {
  let h = 0
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

const PARALLAX_PX = 16 // how far the photo drifts at the window's edge

/**
 * The photo drifts a little against the pointer, like a wallpaper on a tilting phone: it eases toward where the
 * pointer is, and settles when the pointer rests. Off with reduced motion and in efficient mode.
 */
function useParallax(
  root: RefObject<HTMLDivElement | null>,
  photo: RefObject<HTMLImageElement | null>,
  on: boolean
): void {
  useEffect(() => {
    const el = root.current
    if (!on || !el) return
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.fx === 'low'
    ) {
      return
    }
    let tx = 0
    let ty = 0
    let x = 0
    let y = 0
    let raf = 0
    const step = (): void => {
      x += (tx - x) * 0.07
      y += (ty - y) * 0.07
      const img = photo.current
      if (img)
        img.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(1.1)`
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.05 ? requestAnimationFrame(step) : 0
    }
    const onMove = (e: PointerEvent): void => {
      const r = el.getBoundingClientRect()
      tx = -((e.clientX - r.left) / r.width - 0.5) * 2 * PARALLAX_PX
      ty = -((e.clientY - r.top) / r.height - 0.5) * 2 * PARALLAX_PX
      if (!raf) raf = requestAnimationFrame(step)
    }
    el.addEventListener('pointermove', onMove)
    return () => {
      el.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [root, photo, on])
}

const greetingAt = (h: number): string =>
  h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'

/** The time, kept current to the minute. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** A blank tab: the time, one big input that opens the command bar, and the sites you go to most as tiles. */
/** Says how far Tor has got, in a Tor tab opened before Tor was up (the page asked for loads when it is). */
function TorWait({ tor }: { tor: TabsState['tor'] }): React.JSX.Element {
  const working = tor.state === 'downloading' || tor.state === 'starting'
  return (
    <div className="newtab-tor" role="status">
      <ShieldIcon />
      <div>
        <b>
          {working
            ? 'Connecting to Tor'
            : tor.state === 'error'
              ? 'Could not connect to Tor'
              : 'Tor is not running'}
        </b>
        <span>
          {working
            ? tor.message || 'Starting'
            : tor.state === 'error'
              ? tor.message
              : 'Connect to use this tab'}
        </span>
        {working && (
          <span className="newtab-tor-bar" aria-hidden="true">
            <i style={{ transform: `scaleX(${Math.max(0.04, tor.progress / 100)})` }} />
          </span>
        )}
      </div>
      {!working && (
        <button type="button" onClick={() => window.api.torReconnect()}>
          {tor.state === 'error' ? 'Try again' : 'Connect'}
        </button>
      )}
    </div>
  )
}

export function NewTab({
  onOpenSearch,
  photo,
  photoId,
  tor
}: {
  onOpenSearch: () => void
  photo: boolean
  /** The photo kept in the settings, or null for the daily one. */
  photoId: number | null
  /** Tor's state, in a Tor tab: while Tor is not connected the tab says so. */
  tor?: TabsState['tor']
}): React.JSX.Element {
  const [sites, setSites] = useState<LocalSuggestion[]>([])
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)
  const now = useNow()
  const rootRef = useRef<HTMLDivElement>(null)
  const photoRef = useRef<HTMLImageElement>(null)
  useParallax(rootRef, photoRef, photo)
  const shownId = photoId ?? dailyPhotoId(now)

  useEffect(() => {
    let alive = true
    void window.api.suggestLocal('').then((r) => alive && setSites(pickSites(r)))
    return () => {
      alive = false
    }
  }, [])

  return (
    <div ref={rootRef} className={'newtab' + (photo && loaded ? ' has-photo' : '')}>
      {photo && !broken && (
        <img
          ref={photoRef}
          key={shownId}
          className="newtab-photo"
          src={photoUrl(shownId)}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
        />
      )}
      {photo && loaded && (
        <button
          type="button"
          className="newtab-bg"
          title="Change background"
          aria-label="Change background"
          onClick={() => window.api.setNewTabPhoto(nextPhotoId(shownId))}
        >
          <ImageIcon />
        </button>
      )}
      <div className="newtab-body">
        <header className="newtab-hero">
          <time className="newtab-clock" dateTime={now.toISOString()}>
            {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </time>
          <p className="newtab-hello">
            {greetingAt(now.getHours())}
            <span>
              {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
          </p>
        </header>

        {tor && tor.state !== 'ready' && <TorWait tor={tor} />}

        <button type="button" className="newtab-search" onClick={onOpenSearch}>
          <SearchIcon />
          <span>Search or enter address</span>
          <kbd>Ctrl L</kbd>
        </button>

        {sites.length > 0 && (
          <div className="newtab-sites">
            {sites.map((s, i) => {
              const host = displayHost(s.url)
              return (
                <button
                  key={s.url}
                  type="button"
                  className="newtab-site"
                  title={s.title}
                  style={{ '--hue': hueOf(host), '--i': i } as React.CSSProperties}
                  onClick={() => window.api.navigate(s.url)}
                >
                  <SiteTile favicon={s.favicon ?? undefined} host={host} />
                  <span className="newtab-label">{host}</span>
                </button>
              )
            })}
          </div>
        )}

        <footer className="newtab-private">
          <button type="button" onClick={() => window.api.newPrivateTab()}>
            <ShieldIcon />
            Private tab
          </button>
          <button type="button" onClick={() => window.api.newTorTab()}>
            <ShieldIcon />
            Tor tab
          </button>
        </footer>
      </div>
    </div>
  )
}
