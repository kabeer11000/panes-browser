import type { TabInfo } from '@shared/types'
import { displayHost } from '@shared/url'

/** What a tab's title shows: the AI's shorter one when there is one, else the page's own. */
export const tabTitle = (t: TabInfo): string =>
  t.aiTitle || t.title || displayHost(t.url) || 'New tab'
