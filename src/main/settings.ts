import {
  APPEARANCE_LIMITS,
  DEFAULT_SETTINGS,
  SEARCH_ENGINES,
  type AppearanceKey
} from '../shared/settings'
import type { Settings } from '../shared/types'
import { JsonStore } from './store'

type Listener = (settings: Settings) => void

/** Validates untrusted patches (they can come from a panes:// page) before applying them. */
function sanitize(patch: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {}
  if (patch.searchEngine && patch.searchEngine in SEARCH_ENGINES)
    out.searchEngine = patch.searchEngine
  if (typeof patch.adblock === 'boolean') out.adblock = patch.adblock
  if (patch.startup === 'newtab' || patch.startup === 'restore') out.startup = patch.startup
  if (typeof patch.accent === 'string' && /^#[0-9a-f]{6}$/i.test(patch.accent))
    out.accent = patch.accent
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
