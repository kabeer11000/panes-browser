import { useEffect } from 'react'
import logo from '../assets/logo.png'
import { INTERNAL_PAGES, type InternalPage } from '../../../shared/settings'
import { BookmarkIcon, DownloadIcon, HistoryIcon, SettingsIcon } from '../components/icons'
import { Bookmarks } from './pages/Bookmarks'
import { Downloads } from './pages/Downloads'
import { History } from './pages/History'
import { Settings } from './pages/Settings'

const PAGES: Record<
  InternalPage,
  { title: string; icon: React.JSX.Element; view: () => React.JSX.Element }
> = {
  history: { title: 'History', icon: <HistoryIcon />, view: History },
  bookmarks: { title: 'Bookmarks', icon: <BookmarkIcon />, view: Bookmarks },
  downloads: { title: 'Downloads', icon: <DownloadIcon />, view: Downloads },
  settings: { title: 'Settings', icon: <SettingsIcon />, view: Settings }
}

const current = (INTERNAL_PAGES as readonly string[]).includes(location.hostname)
  ? (location.hostname as InternalPage)
  : 'history'

export function Shell(): React.JSX.Element {
  const page = PAGES[current]
  const View = page.view

  useEffect(() => {
    document.title = page.title
    void window.panesInternal.getSettings().then((s) => {
      document.documentElement.style.setProperty('--accent', s.accent)
      document.documentElement.dataset.scheme = (s as { scheme?: string }).scheme ?? 'dark'
    })
  }, [page.title])

  return (
    <div className="int-shell">
      <nav className="int-nav">
        <div className="int-brand">
          <img src={logo} alt="" width={26} height={26} />
          Panes
        </div>
        {INTERNAL_PAGES.map((p) => (
          <a key={p} href={`panes://${p}`} className={p === current ? 'active' : ''}>
            {PAGES[p].icon}
            <span>{PAGES[p].title}</span>
          </a>
        ))}
      </nav>
      <main className="int-main">
        <h1>{page.title}</h1>
        <View />
      </main>
    </div>
  )
}
