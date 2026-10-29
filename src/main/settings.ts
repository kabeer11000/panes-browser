import {
  APPEARANCE_LIMITS,
  DEFAULT_SETTINGS,
  SEARCH_ENGINES,
  type AppearanceKey
} from '../shared/settings'
import { IDLE_CHOICES_MIN, MAX_LOADED_CHOICES, normalizeSites } from '../shared/memory'
import { isPerformanceMode } from '../shared/performance'
import type { Settings } from '../shared/types'
import { JsonStore } from './store'

type Listener = (settings: Settings) => void

/** Validates untrusted patches (they can come from a panes:// page) before applying them. */
function sanitize(patch: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {}
  if (patch.searchEngine && patch.searchEngine in SEARCH_ENGINES)
    out.searchEngine = patch.searchEngine
  if (typeof patch.adblock === 'boolean') out.adblock = patch.adblock
  if (typeof patch.onboarded === 'boolean') out.onboarded = patch.onboarded
  if (typeof patch.askDefaultBrowser === 'boolean') out.askDefaultBrowser = patch.askDefaultBrowser
  if (isPerformanceMode(patch.performanceMode)) out.performanceMode = patch.performanceMode
  if (patch.adblockOffSites !== undefined)
    out.adblockOffSites = normalizeSites(patch.adblockOffSites)
  if (patch.adblockCosmeticOffSites !== undefined)
    out.adblockCosmeticOffSites = normalizeSites(patch.adblockCosmeticOffSites)
  if (patch.mutedSites !== undefined) out.mutedSites = normalizeSites(patch.mutedSites)
  if (typeof patch.torSnowflake === 'boolean') out.torSnowflake = patch.torSnowflake
  if (patch.startup === 'newtab' || patch.startup === 'restore') out.startup = patch.startup
  if (typeof patch.accent === 'string' && /^#[0-9a-f]{6}$/i.test(patch.accent))
    out.accent = patch.accent
  if (patch.searchStyle === 'dropdown' || patch.searchStyle === 'center')
    out.searchStyle = patch.searchStyle
  if (typeof patch.autoHideTopBar === 'boolean') out.autoHideTopBar = patch.autoHideTopBar
  if (typeof patch.sidebarHover === 'boolean') out.sidebarHover = patch.sidebarHover
  if (typeof patch.fullWidthAddress === 'boolean') out.fullWidthAddress = patch.fullWidthAddress
  if (patch.tabLayout === 'vertical' || patch.tabLayout === 'horizontal') {
    out.tabLayout = patch.tabLayout
  }
  if (typeof patch.searchSuggestions === 'boolean') out.searchSuggestions = patch.searchSuggestions
  if (patch.urlDisplay === 'full' || patch.urlDisplay === 'host') out.urlDisplay = patch.urlDisplay
  if (typeof patch.darkenSites === 'boolean') out.darkenSites = patch.darkenSites
  if (typeof patch.memorySaver === 'boolean') out.memorySaver = patch.memorySaver
  if (typeof patch.unloadOtherSpaces === 'boolean') out.unloadOtherSpaces = patch.unloadOtherSpaces
  if ((IDLE_CHOICES_MIN as readonly unknown[]).includes(patch.unloadIdleMin)) {
    out.unloadIdleMin = patch.unloadIdleMin
  }
  if ((MAX_LOADED_CHOICES as readonly unknown[]).includes(patch.maxLoadedTabs)) {
    out.maxLoadedTabs = patch.maxLoadedTabs
  }
  if (patch.neverUnloadSites !== undefined) {
    out.neverUnloadSites = normalizeSites(patch.neverUnloadSites)
  }
  for (const key of Object.keys(APPEARANCE_LIMITS) as AppearanceKey[]) {
    const v = patch[key]
    const { min, max } = APPEARANCE_LIMITS[key]
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.min(max, Math.max(min, v))
  }
  return out
}

export class SettingsStore {
  private store = new JsonStore<Settings>('settings', DEFAULT_SETTINGS)
  private listeners: Listener[] = []

  get(): Settings {
    return this.store.value
  }

  searchUrl(): string {
    return SEARCH_ENGINES[this.store.value.searchEngine].url
  }

  update(patch: Partial<Settings>): Settings {
    this.store.value = { ...this.store.value, ...sanitize(patch) }
    this.store.save()
    for (const l of this.listeners) l(this.store.value)
    return this.store.value
  }

  onChange(l: Listener): void {
    this.listeners.push(l)
  }
}
