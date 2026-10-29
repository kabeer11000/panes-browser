import { useEffect, useState } from 'react'
import { INTERNAL_PAGES, type InternalPage } from '../../../shared/settings'
import type { SpaceMode } from '../../../shared/types'
import { useScheme } from '../useScheme'
import {
  BookmarkIcon,
  DownloadIcon,
  HistoryIcon,
  KeyIcon,
  SettingsIcon,
  ShieldIcon,
  SoftwareIcon
} from '../components/icons'
import { Bookmarks } from './pages/Bookmarks'
import { Downloads } from './pages/Downloads'
import { History } from './pages/History'
import { Passwords } from './pages/Passwords'
import { Settings } from './pages/Settings'
import { Privacy } from './pages/Privacy'
import { Software } from './pages/Software'

const PAGES: Record<
  InternalPage,
  { title: string; icon: React.JSX.Element; view: () => React.JSX.Element; bare?: boolean }
> = {
  history: { title: 'History', icon: <HistoryIcon />, view: History },
  bookmarks: { title: 'Bookmarks', icon: <BookmarkIcon />, view: Bookmarks },
  downloads: { title: 'Downloads', icon: <DownloadIcon />, view: Downloads },
  passwords: { title: 'Passwords', icon: <KeyIcon />, view: Passwords },
  settings: { title: 'Settings', icon: <SettingsIcon />, view: Settings },
  privacy: { title: 'Private and Tor', icon: <ShieldIcon />, view: Privacy },
  // the page opens on the app itself; a heading above it would only repeat what the tab says
  software: { title: 'Software', icon: <SoftwareIcon />, view: Software, bare: true }
}

const current = (INTERNAL_PAGES as readonly string[]).includes(location.hostname)
  ? (location.hostname as InternalPage)
  : 'history'

export function Shell(): React.JSX.Element {
  const page = PAGES[current]
  const View = page.view

  const [scrolled, setScrolled] = useState(false)
  // Hold the content until the scheme and accent are applied, so light mode never paints dark first.
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<SpaceMode>('system')
  const scheme = useScheme(mode)
  useEffect(() => {
    document.documentElement.dataset.scheme = scheme
  }, [scheme])

  useEffect(() => {
    document.title = page.title
    void window.panesInternal.getSettings().then((s) => {
      const { scheme: m, chromeVars } = s as {
        scheme?: SpaceMode
        chromeVars?: Record<string, string>
      }
      // The page wears the window's colours (accent, space colour, readable tint), so recolouring a space recolours it too.
      for (const [k, v] of Object.entries(chromeVars ?? {}))
        document.documentElement.style.setProperty(k, v)
      setMode(m ?? 'system')
      document.documentElement.style.removeProperty('--stage-bg')
      setReady(true)
    })
  }, [page.title])

  // The big title scrolls away; once it has, the small one fades into the bar.
  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 48)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!ready) return <></>

  return (
    <>
      {!page.bare && (
        <header className={'int-bar' + (scrolled ? ' on' : '')} aria-hidden="true">
          {page.title}
        </header>
      )}
      <main className={'int-main' + (page.bare ? ' bare' : '')}>
        {!page.bare && <h1>{page.title}</h1>}
        <View />
      </main>
      <div className="int-fade" />
      <nav className="int-tabs" aria-label="Panes pages">
        <div className="int-tabs-pill">
          {INTERNAL_PAGES.map((p) => (
            <a key={p} href={`panes://${p}`} aria-current={p === current ? 'page' : undefined}>
              {PAGES[p].icon}
              <span>{PAGES[p].title}</span>
            </a>
          ))}
        </div>
      </nav>
    </>
  )
}
