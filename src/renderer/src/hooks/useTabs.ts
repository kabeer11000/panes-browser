import { useEffect, useState } from 'react'
import type { TabInfo, TabsState } from '../../../shared/types'

export interface TabsView extends TabsState {
  thumbs: Record<number, string>
  active: TabInfo | null
}

export function useTabs(): TabsView {
  const [state, setState] = useState<TabsState>({ tabs: [], activeId: null, layout: null })
  const [thumbs, setThumbs] = useState<Record<number, string>>({})

  useEffect(() => {
    let alive = true
    window.api.getState().then((d) => {
      if (!alive) return
      setState(d.state)
      setThumbs((t) => ({ ...d.thumbs, ...t }))
    })
    const offState = window.api.onState(setState)
    const offThumb = window.api.onThumb((id, url) => setThumbs((t) => ({ ...t, [id]: url })))
    return () => {
      alive = false
      offState()
      offThumb()
    }
  }, [])

  const active = state.tabs.find((t) => t.id === state.activeId) ?? null
  return { ...state, thumbs, active }
}
