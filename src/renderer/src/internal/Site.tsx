import { SiteIcon } from '@renderer/components/SiteIcon'

/** A site's icon in history and bookmarks (the globe when it has none, as everywhere). */
export function Site({ favicon }: { favicon: string | null }): React.JSX.Element {
  return <SiteIcon src={favicon} className="site-icon" />
}
