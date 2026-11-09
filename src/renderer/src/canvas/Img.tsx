import { useState } from 'react'
import type { CardModel } from './model'

/** A picture from the web: one that will not load shows `fallback` (nothing by default), not a broken image. */
export function Img({
  src,
  fallback = null
}: {
  src: string
  fallback?: React.ReactNode
}): React.JSX.Element | null {
  const [bad, setBad] = useState<string | null>(null)
  if (bad === src) return <>{fallback}</>
  return <img src={src} alt="" decoding="async" draggable={false} onError={() => setBad(src)} />
}

/** A site's icon, or the first letter of its name when it has none or it will not load. */
export function Favicon({
  m
}: {
  m: Pick<CardModel, 'favicon' | 'site' | 'title'>
}): React.JSX.Element {
  const letter = <span>{(m.site || m.title || '?').charAt(0).toUpperCase()}</span>
  return m.favicon ? <Img src={m.favicon} fallback={letter} /> : letter
}
