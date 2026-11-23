import { useEffect, useRef, useState } from 'react'
import type { SharePerson, ShareState, Space, TabInfo } from '@shared/types'
import { hostViewsNow, publish, useLiveHost, type HostView } from './liveHost'

function LiveHost({
  spaceId,
  tabId,
  people,
  muted,
  spaceName
}: {
  spaceId: number
  tabId: number
  people: SharePerson[]
  muted: boolean
  spaceName: string
}): null {
  const h = useLiveHost(spaceId, tabId, people, muted)
  const latest = useRef(h)
  useEffect(() => {
    latest.current = h
  })
  const { watching, asking, driver } = h
  useEffect(() => {
    const view: HostView = {
      spaceId,
      spaceName,
      tabId,
      watching,
      asking,
      driver,
      allow: () => latest.current.allow(),
      deny: () => latest.current.deny(),
      takeBack: () => latest.current.takeBack(),
      stop: () => void window.api.share?.showLive(spaceId, null)
    }
    publish([...hostViewsNow().filter((v) => v.spaceId !== spaceId), view])
  }, [spaceId, spaceName, tabId, watching, asking, driver])
  useEffect(() => () => publish(hostViewsNow().filter((v) => v.spaceId !== spaceId)), [spaceId])
  return null
}

/**
 * The host side of every tab this person shows live, in any shared space: mounted once in the window (App), so a
 * live tab keeps going while its host browses it, or another space, away from the board.
 */
export function LiveHosts({
  spaces,
  tabs
}: {
  spaces: Space[]
  tabs: TabInfo[]
}): React.JSX.Element {
  const shared = spaces.filter((s) => s.shared).map((s) => s.id)
  const key = shared.join(',')
  const [states, setStates] = useState<Record<number, ShareState>>({})
  useEffect(() => {
    const share = window.api.share
    if (!share || !key) return
    let alive = true
    for (const id of key.split(',').map(Number))
      void share.state(id).then((s) => {
        if (alive && s) setStates((m) => ({ ...m, [id]: s }))
      })
    const off = share.onState((id, s) => setStates((m) => ({ ...m, [id]: s })))
    return () => {
      alive = false
      off()
    }
  }, [key])
  return (
    <>
      {shared.map((id) => {
        const s = states[id]
        if (!s || s.liveTab === null || s.liveTab === undefined) return null
        const tab = tabs.find((t) => t.id === s.liveTab)
        return (
          <LiveHost
            key={id}
            spaceId={id}
            tabId={s.liveTab}
            people={s.people}
            muted={!!tab?.muted}
            spaceName={spaces.find((x) => x.id === id)?.name ?? 'a shared space'}
          />
        )
      })}
    </>
  )
}
