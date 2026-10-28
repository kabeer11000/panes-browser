import type { TabInfo } from '../../shared/types'
import { displayHost } from '../../shared/url'

export const tabTitle = (t: TabInfo): string => t.title || displayHost(t.url) || 'New tab'
