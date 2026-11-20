import { useState } from 'react'
import { GlobeIcon } from './icons'

/**
 * A site's icon, or the globe when it has none or it will not load: one fallback everywhere a site is shown (tabs,
 * the preview, cards, the new tab page, history, search), never a letter in one place and a globe in another.
 */
export function SiteIcon({
  src,
  className,
  decoding = 'async'
}: {
  src?: string | null
  className?: string
  /** `sync` where the icon must show in the same frame as what holds it (the preview's header). */
  decoding?: 'sync' | 'async'
}): React.JSX.Element {
  const [bad, setBad] = useState<string | null>(null)
  if (!src || bad === src) {
    return (
      <span className={'site-globe' + (className ? ` ${className}` : '')} aria-hidden="true">
        <GlobeIcon />
      </span>
    )
  }
  return (
    <img
      className={className}
      src={src}
      alt=""
      decoding={decoding}
      draggable={false}
      onError={() => setBad(src)}
    />
  )
}
