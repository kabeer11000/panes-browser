import type { Session } from 'electron'
import { originOf, type PermDecision, type PermKind, type SiteGrant } from '../shared/permissions'
import { normalizeSites, siteListed } from '../shared/memory'
import { DEFAULT_THEME, sanitizeSiteTheme, siteKey } from '../shared/sitetheme'
import type { SiteInfo, SitePatch } from '../shared/types'
import type { PermissionStore } from './permissions'
import type { SettingsStore } from './settings'
import type { SpaceStore } from './spaces'

/** The kinds a site can be given a decision for in the panel. */
const KINDS: readonly PermKind[] = [
  'camera',
  'microphone',
  'location',
  'notifications',
  'clipboard'
]
const isKind = (v: unknown): v is PermKind => KINDS.includes(v as PermKind)

interface Deps {
  settings: SettingsStore
  /** The browsing session, for the site's cookies and stored data. */
  session: Session
  spaces: SpaceStore
  permissions: PermissionStore
  /** The page the panel is about: the active tab's address and its space. */
  active: () => { url: string; spaceId: number; contentsId: number } | null
  /** How many requests the ad blocker has stopped on the page shown in the given WebContents. */
  blocked: (contentsId: number) => number
  /** How large pages start out in a space (a zoom level). */
  defaultZoom: (spaceId: number) => number
  /** Mute or unmute a whole site. */
  muteSite: (key: string, muted: boolean) => void
  /** Re-apply boosts and the ad blocker's exceptions after a change. */
  changed: () => void
}

/**
 * Everything you can set for one site from the address bar: its ad blocker exception, its boost in
 * this space, whether its tab may be unloaded, and what it may access. A thin layer over the stores
 * that already hold each of those.
 */
export class SiteSettings {
  constructor(private d: Deps) {}

  async info(): Promise<SiteInfo | null> {
    const page = this.d.active()
    const key = page && siteKey(page.url)
    const origin = page && originOf(page.url)
    if (!page || !key || !origin) return null
    const settings = this.d.settings.get()
    const space = this.d.spaces.get(page.spaceId)
    const perms: SiteInfo['perms'] = {}
    for (const g of this.d.permissions.list() as SiteGrant[]) {
      if (g.origin === origin && isKind(g.kind)) perms[g.kind] = g.decision
    }
    const cookies = await this.d.session.cookies.get({ url: origin }).catch(() => [])
    return {
      key,
      origin,
      cookies: cookies.length,
      secure: origin.startsWith('https:'),
      spaceName: space?.name ?? '',
      adblock: {
        global: settings.adblock,
        off: siteListed(key, settings.adblockOffSites),
        cosmetic: !siteListed(key, settings.adblockCosmeticOffSites),
        blocked: this.d.blocked(page.contentsId)
      },
      boost: space?.sites[key] ?? null,
      theme: { color: space?.color ?? '#6e7bff', tint: space?.tint ?? 0 },
      keepLoaded: siteListed(key, settings.neverUnloadSites),
      muted: siteListed(key, settings.mutedSites),
      zoom: settings.siteZoom[key] ?? this.d.defaultZoom(page.spaceId),
      defaultZoom: this.d.defaultZoom(page.spaceId),
      perms
    }
  }

  async update(raw: unknown): Promise<SiteInfo | null> {
    const page = this.d.active()
    const key = page && siteKey(page.url)
    const origin = page && originOf(page.url)
    if (!page || !key || !origin || !raw || typeof raw !== 'object') return this.info()
    const patch = raw as SitePatch
    const settings = this.d.settings.get()

    if (patch.reset === true) {
      this.d.settings.update({
        adblockOffSites: settings.adblockOffSites.filter((s) => s !== key),
        adblockCosmeticOffSites: settings.adblockCosmeticOffSites.filter((s) => s !== key),
        neverUnloadSites: settings.neverUnloadSites.filter((s) => s !== key)
      })
      this.d.spaces.setSite(page.spaceId, key, null)
      for (const kind of KINDS) this.d.permissions.remove(origin, kind)
    }
    if (typeof patch.adblockOff === 'boolean') {
      const rest = settings.adblockOffSites.filter((s) => s !== key)
      this.d.settings.update({ adblockOffSites: patch.adblockOff ? [...rest, key] : rest })
    }
    if (typeof patch.adblockCosmetic === 'boolean') {
      const rest = settings.adblockCosmeticOffSites.filter((s) => s !== key)
      this.d.settings.update({
        adblockCosmeticOffSites: patch.adblockCosmetic ? rest : [...rest, key]
      })
    }
    if (typeof patch.zoom === 'number') {
      const rest = { ...settings.siteZoom }
      delete rest[key]
      if (patch.zoom !== this.d.defaultZoom(page.spaceId)) rest[key] = patch.zoom
      this.d.settings.update({ siteZoom: rest }) // the settings store keeps it within range
    }
    if (typeof patch.muted === 'boolean') this.d.muteSite(key, patch.muted)
    if (typeof patch.keepLoaded === 'boolean') {
      const rest = settings.neverUnloadSites.filter((s) => s !== key)
      this.d.settings.update({
        neverUnloadSites: normalizeSites(patch.keepLoaded ? [...rest, key] : rest)
      })
    }
    if (patch.allowCalls === true) {
      this.d.permissions.set(origin, ['camera', 'microphone', 'screen'], 'allow')
    }
    if (patch.clearData === true) {
      await this.d.session.clearStorageData({ origin })
    }
    if (patch.boost !== undefined) {
      this.d.spaces.setSite(page.spaceId, key, sanitizeSiteTheme(patch.boost))
    }
    // Hiding or restoring one element edits the boost's list without the panel having to send all of it.
    const edit = typeof patch.zapAdd === 'string' || typeof patch.zapRemove === 'string'
    if (edit) {
      const current = this.d.spaces.get(page.spaceId)?.sites[key] ?? DEFAULT_THEME
      const zap = current.zap.filter((z) => z !== patch.zapRemove)
      if (typeof patch.zapAdd === 'string') zap.push(patch.zapAdd)
      this.d.spaces.setSite(page.spaceId, key, sanitizeSiteTheme({ ...current, zap }))
    }
    if (patch.perm && isKind(patch.perm.kind)) {
      const { kind, decision } = patch.perm
      if (decision === 'allow' || decision === 'block') {
        this.d.permissions.set(origin, [kind], decision as PermDecision)
      } else {
        this.d.permissions.remove(origin, kind)
      }
    }
    this.d.changed()
    return this.info()
  }
}
