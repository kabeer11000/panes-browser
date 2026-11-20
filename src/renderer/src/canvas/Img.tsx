import { useState } from 'react'
import { SiteIcon } from '@renderer/components/SiteIcon'
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

/** A site's icon, or the globe when it has none or it will not load (as everywhere else, see SiteIcon). */
export function Favicon({ m }: { m: Pick<CardModel, 'favicon'> }): React.JSX.Element {
  return <SiteIcon src={m.favicon} />
}
