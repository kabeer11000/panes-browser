import { useCallback, useEffect, useRef, useState } from 'react'
import type { SiteInfo, SitePanelApi, SitePatch } from '../../../shared/types'
import { CloseIcon } from '../components/icons'
import { Boost } from './Boost'
import { SiteHome } from './SiteHome'

declare global {
  interface Window {
    sitePanel: SitePanelApi
  }
}

/**
 * The site settings card under the address bar's site button. Main owns the state: the card reads it when it
 * opens, is sent it again whenever it changes while open (the tab navigates, a permission is answered, a
 * setting changes elsewhere), and shows what each change returns, optimistically first so controls never lag.
 */
export function Panel(): React.JSX.Element {
  const api = window.sitePanel
  // undefined until the first read; null on a page that is not a web site (panes://, files)
  const [info, setInfo] = useState<SiteInfo | null | undefined>(undefined)
  const [view, setView] = useState<'home' | 'boost'>('home')
  const [opened, setOpened] = useState(0)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const open = (): void => {
      void api.info().then((i) => {
        setInfo(i)
        setView('home')
        setOpened((n) => n + 1)
      })
    }
    open()
    const offShow = api.onShow(open)
    const offInfo = api.onInfo(setInfo)
    return () => {
      offShow()
      offInfo()
    }
  }, [api])

  // Focus goes to the card itself, so Tab starts at its first control and Esc reaches it, with no ring drawn.
  useEffect(() => {
    if (opened > 0) dialog.current?.focus()
  }, [opened])

  // The card is thrown away when the panel closes, so the next opening starts from nothing: it fades in fresh, and
  // never shows the last site's settings for a frame first.
  useEffect(
    () =>
      api.onHide(() => {
        setInfo(undefined)
        setView('home')
      }),
    [api]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (view === 'boost') setView('home')
      else api.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api, view])

  const send = useCallback(
    (patch: SitePatch, optimistic?: (i: SiteInfo) => SiteInfo): void => {
      if (optimistic) setInfo((i) => (i ? optimistic(i) : i))
      void api.update(patch).then((i) => i && setInfo(i))
    },
    [api]
  )

  return (
    // the view reaches the window's bottom (see place in main/sitePanel.ts): a press outside the card is a click away
    <div
      className="pn-root"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) api.close()
      }}
    >
      {info !== undefined && (
        <div className="pn" role="dialog" aria-label="Site settings" tabIndex={-1} ref={dialog}>
          {info === null ? (
            <div className="pn-view pn-none">
              <p>Site settings are for web pages. This page belongs to Panes or your computer.</p>
              <button type="button" className="pn-icon-btn" aria-label="Close" onClick={api.close}>
                <CloseIcon />
              </button>
            </div>
          ) : view === 'home' ? (
            <SiteHome
              info={info}
              send={send}
              onBoost={() => setView('boost')}
              onClose={api.close}
            />
          ) : (
            <Boost api={api} info={info} send={send} onBack={() => setView('home')} />
          )}
        </div>
      )}
    </div>
  )
}
