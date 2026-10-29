import { nativeTheme } from 'electron'
import { APPEARANCE_LIMITS, SPACE_COLORS, type AppearanceKey } from '../shared/settings'
import { defaultSpaceIcon, isSpaceIcon, type SpaceIcon } from '../shared/spaceicons'
import { MAX_SITES_PER_SPACE, sanitizeSiteTheme } from '../shared/sitetheme'
import type { SiteTheme, Space, SpacePatch, SpaceUi } from '../shared/types'
import { JsonStore } from './store'

const MAX_NAME = 24
const HEX = /^#[0-9a-f]{6}$/i
const DEFAULT_TINT = 0.24
const DEFAULT_GRAIN = 0.4

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback

/** Untrusted input (it can come from a panes:// page): keep only known, in-range interface overrides. */
function sanitizeUi(raw: unknown): SpaceUi {
  const out: SpaceUi = {}
  if (!raw || typeof raw !== 'object') return out
  const ui = raw as Record<string, unknown>
  for (const key of Object.keys(APPEARANCE_LIMITS) as AppearanceKey[]) {
    const v = ui[key]
    const { min, max } = APPEARANCE_LIMITS[key]
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.min(max, Math.max(min, v))
  }
  if (ui.urlDisplay === 'full' || ui.urlDisplay === 'host') out.urlDisplay = ui.urlDisplay
  return out
}

interface SpaceData {
  nextId: number
  activeId: number
  spaces: Space[]
  /** Spaces used to default to dark; set once they have been moved to follow the system. */
  followsSystem?: boolean
}

const newSpace = (id: number, name: string, color: string, icon: SpaceIcon): Space => ({
  id,
  name,
  color,
  icon,
  color2: null,
  tint: DEFAULT_TINT,
  grain: DEFAULT_GRAIN,
  mode: 'system',
  ui: {},
  sites: {}
})

/** Spaces: named, themed groups of tabs that can carry their own interface settings. */
export class SpaceStore {
  private store = new JsonStore<SpaceData>('spaces', {
    nextId: 2,
    activeId: 1,
    spaces: [newSpace(1, 'Home', SPACE_COLORS[0], 'home')]
  })

  constructor() {
    const d = this.store.value
    d.spaces.forEach((sp, i) => {
      if (!isSpaceIcon(sp.icon)) sp.icon = i === 0 ? 'home' : defaultSpaceIcon(i)
      sp.color2 ??= null
      sp.tint ??= DEFAULT_TINT
      sp.grain ??= DEFAULT_GRAIN
      sp.mode ??= 'system'
      sp.ui ??= {}
      sp.sites ??= {}
      // boosts saved by an older version gain the newer fields (and a broken one is dropped)
      for (const [key, theme] of Object.entries(sp.sites)) {
        const fixed = sanitizeSiteTheme(theme)
        if (fixed) sp.sites[key] = fixed
        else delete sp.sites[key]
      }
      if (!d.followsSystem) sp.mode = 'system'
    })
    if (!d.followsSystem) {
      d.followsSystem = true
      this.store.save()
    }
    this.applyTheme()
  }

  /**
   * Make Electron's theme match the active space, so everything it draws (the Mica backdrop, menus,
   * and prefers-color-scheme in the UI and in pages) agrees with the interface. 'system' follows the OS live.
   */
  private applyTheme(): void {
    nativeTheme.themeSource = this.get(this.activeId())?.mode ?? 'system'
  }

  list(): Space[] {
    return this.store.value.spaces
  }

  get(id: number): Space | undefined {
    return this.store.value.spaces.find((s) => s.id === id)
  }

  /** The saved active space, or the first one if it no longer exists. */
  activeId(): number {
    const d = this.store.value
    return this.get(d.activeId) ? d.activeId : d.spaces[0].id
  }

  setActive(id: number): void {
    if (!this.get(id)) return
    this.store.value.activeId = id
    this.store.save()
    this.applyTheme()
  }

  add(): Space {
    const d = this.store.value
    const space = newSpace(
      d.nextId++,
      `Space ${d.spaces.length + 1}`,
      SPACE_COLORS[d.spaces.length % SPACE_COLORS.length],
      defaultSpaceIcon(d.spaces.length)
    )
    d.spaces.push(space)
    this.store.save()
    return space
  }

  update(id: number, patch: SpacePatch): void {
    const space = this.get(id)
    if (!space) return
    if (typeof patch.name === 'string' && patch.name.trim()) {
      space.name = patch.name.trim().slice(0, MAX_NAME)
    }
    if (typeof patch.color === 'string' && HEX.test(patch.color)) space.color = patch.color
    if (patch.color2 === null) space.color2 = null
    else if (typeof patch.color2 === 'string' && HEX.test(patch.color2)) space.color2 = patch.color2
    if (patch.tint !== undefined) space.tint = clamp01(patch.tint, space.tint)
    if (patch.grain !== undefined) space.grain = clamp01(patch.grain, space.grain)
    if (isSpaceIcon(patch.icon)) space.icon = patch.icon
    if (patch.mode === 'system' || patch.mode === 'dark' || patch.mode === 'light') {
      space.mode = patch.mode
    }
    if (patch.ui !== undefined) space.ui = sanitizeUi(patch.ui)
    this.store.save()
    this.applyTheme()
  }

  /** Set or clear one site's boost in a space. */
  setSite(id: number, key: string, theme: SiteTheme | null): void {
    const space = this.get(id)
    if (!space) return
    if (theme === null) delete space.sites[key]
    else if (key in space.sites || Object.keys(space.sites).length < MAX_SITES_PER_SPACE) {
      space.sites[key] = theme
    }
    this.store.save()
  }

  /** The last space cannot be removed. */
  remove(id: number): boolean {
    const d = this.store.value
    if (d.spaces.length <= 1 || !this.get(id)) return false
    d.spaces = d.spaces.filter((s) => s.id !== id)
    this.store.save()
    return true
  }
}
