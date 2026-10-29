import { useEffect, useRef, useState } from 'react'
import type { TabCardApi, TabCardInfo } from '../../../shared/types'

declare global {
  interface Window {
    tabcard: TabCardApi
  }
}

const memory = (mb: number): string => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`)

function memoryLine(info: TabCardInfo): string {
  if (info.unloaded) return 'Unloaded, 0 MB'
  if (info.memoryMb === null) return 'Not available'
  return info.shared ? `About ${memory(info.memoryMb)}, shared` : memory(info.memoryMb)
}

export function TabCard(): React.JSX.Element | null {
  const api = window.tabcard
  const [info, setInfo] = useState<TabCardInfo | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const shown = info !== null

  useEffect(() => {
    void api.state().then(setInfo)
    return api.onState(setInfo)
  }, [api])

  // The view is only as tall as the card, so it never covers page area it has no business covering.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => api.resize(el.getBoundingClientRect().height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [api, shown])

  if (!info) return null
  const notes = [
    info.audible && !info.muted ? 'Playing audio' : '',
    info.muted ? 'Muted' : '',
    info.tor ? 'Tor' : info.private ? 'Private' : ''
  ].filter(Boolean)
  return (
    <div className="tc-root" ref={box}>
      <div className="tc-card">
        <div className="tc-title">{info.title || info.host || 'New tab'}</div>
        {info.host && info.host !== info.title && <div className="tc-host">{info.host}</div>}
        <div className="tc-row">
          <span>Memory</span>
          <b>{memoryLine(info)}</b>
        </div>
        {notes.length > 0 && <div className="tc-notes">{notes.join('  ·  ')}</div>}
      </div>
    </div>
  )
}
