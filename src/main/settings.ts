import { isBrowseWith } from '@shared/browse'
import { MAIL_HANDLERS } from '@shared/mailto'
import { PHOTO_IDS } from '@shared/photos'
import {
  APPEARANCE_LIMITS,
  DEFAULT_SETTINGS,
  SEARCH_ENGINES,
  type AppearanceKey
} from '@shared/settings'
import { IDLE_CHOICES_MIN, MAX_LOADED_CHOICES, normalizeSites, normalizeZoom } from '@shared/memory'
import { isPerformanceMode } from '@shared/performance'
import type { Settings } from '@shared/types'
import { sanitizeYouTube } from '@shared/youtube'
import { sanitizeAi } from '@shared/ai/settings'
import { DEFAULT_AI_SETTINGS } from '@shared/ai/types'
import { JsonStore } from './store'
import { SMOOTHING_DELAY_MS } from '@shared/freeScroll'

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
  if (typeof patch.adblockAggressive === 'boolean') out.adblockAggressive = patch.adblockAggressive
  if (patch.adblockAggressiveSites !== undefined)
    out.adblockAggressiveSites = normalizeSites(patch.adblockAggressiveSites)
  if (patch.siteZoom !== undefined) out.siteZoom = normalizeZoom(patch.siteZoom)
  if (patch.mutedSites !== undefined) out.mutedSites = normalizeSites(patch.mutedSites)
  if (typeof patch.torSnowflake === 'boolean') out.torSnowflake = patch.torSnowflake
  if (typeof patch.downloadAsk === 'boolean') out.downloadAsk = patch.downloadAsk
  if (patch.downloadDir === null) out.downloadDir = null // reset only: a folder comes from the picker (setDownloadDir)
  if (patch.startup === 'newtab' || patch.startup === 'restore') out.startup = patch.startup
  if (typeof patch.accent === 'string' && /^#[0-9a-f]{6}$/i.test(patch.accent))
    out.accent = patch.accent
  if (patch.searchStyle === 'dropdown' || patch.searchStyle === 'center')
    out.searchStyle = patch.searchStyle
  if (patch.paneView === 'full' || patch.paneView === 'side') out.paneView = patch.paneView
  if (MAIL_HANDLERS.some((h) => h.value === patch.mailHandler)) out.mailHandler = patch.mailHandler
  if (patch.paneViewRelease === 'select' || patch.paneViewRelease === 'stay') {
    out.paneViewRelease = patch.paneViewRelease
  }
  if (typeof patch.autoHideTopBar === 'boolean') out.autoHideTopBar = patch.autoHideTopBar
  if (typeof patch.sidebarHover === 'boolean') out.sidebarHover = patch.sidebarHover
  if (typeof patch.fullWidthAddress === 'boolean') out.fullWidthAddress = patch.fullWidthAddress
  if (patch.tabLayout === 'vertical' || patch.tabLayout === 'horizontal') {
    out.tabLayout = patch.tabLayout
  }
  if (isBrowseWith(patch.browseWith)) out.browseWith = patch.browseWith
  if (typeof patch.newTabPhoto === 'boolean') out.newTabPhoto = patch.newTabPhoto
  if (typeof patch.newTabDither === 'boolean') out.newTabDither = patch.newTabDither
  if (patch.newTabPhotoId === null || PHOTO_IDS.includes(patch.newTabPhotoId as number)) {
    out.newTabPhotoId = patch.newTabPhotoId as number | null
  }
  if (typeof patch.searchSuggestions === 'boolean') out.searchSuggestions = patch.searchSuggestions
  if (patch.urlDisplay === 'full' || patch.urlDisplay === 'host') out.urlDisplay = patch.urlDisplay
  if (
    patch.frozenBlur === 'off' ||
    patch.frozenBlur === 'slight' ||
    patch.frozenBlur === 'strong'
  ) {
    out.frozenBlur = patch.frozenBlur
  }
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
  const num = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined
  const speed = num(patch.touchpadSpeed, 0.3, 3)
  if (speed !== undefined) out.touchpadSpeed = speed
  const glide = num(patch.touchpadGlide, 0, 1500)
  if (glide !== undefined) out.touchpadGlide = glide
  if (typeof patch.touchpadSmoothing === 'string' && patch.touchpadSmoothing in SMOOTHING_DELAY_MS)
    out.touchpadSmoothing = patch.touchpadSmoothing
  if (
    patch.previewSwipe === 'off' ||
    patch.previewSwipe === 'edge' ||
    patch.previewSwipe === 'easy'
  )
    out.previewSwipe = patch.previewSwipe
  Object.assign(out, sanitizeYouTube(patch))
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

  constructor() {
    // a settings file from before AI existed, or one with only some of its fields
    this.store.value.ai = sanitizeAi(this.store.value.ai, DEFAULT_AI_SETTINGS)
  }

  get(): Settings {
    return this.store.value
  }

  searchUrl(): string {
    return SEARCH_ENGINES[this.store.value.searchEngine].url
  }

  update(patch: Partial<Settings>): Settings {
    const next = { ...this.store.value, ...sanitize(patch) }
    if (patch.ai !== undefined) next.ai = sanitizeAi(patch.ai, this.store.value.ai)
    this.store.value = next
    this.store.save()
    for (const l of this.listeners) l(this.store.value)
    return this.store.value
  }

  /** A folder the user picked in a native dialog: not taken from a patch, which a page could fill with any path. */
  setDownloadDir(dir: string): void {
    this.store.value = { ...this.store.value, downloadDir: dir }
    this.store.save()
    for (const l of this.listeners) l(this.store.value)
  }

  /** Where the AI models now are: only after they were moved there, never from a page's patch. */
  setAiModelsDir(dir: string | null): void {
    this.store.value = { ...this.store.value, aiModelsDir: dir }
    this.store.save()
    for (const l of this.listeners) l(this.store.value)
  }

  onChange(l: Listener): void {
    this.listeners.push(l)
  }
}
