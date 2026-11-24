import { cachedIcon } from '@shared/favicon'

/**
 * A site's icon as this window loads it: through the disk cache (shared/favicon.ts) in Panes' own windows, as it is in
 * the panes:// pages (they run in the tabs' session, which has no such cache: web pages must not reach it).
 */
export const iconSrc = (src: string): string =>
  typeof location !== 'undefined' && location.protocol !== 'panes:' ? cachedIcon(src) : src
