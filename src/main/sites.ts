import { webContents, type Session } from 'electron'
import type { CaptureState } from '../shared/capture'
import { isPermKind, originOf, PERM_KINDS, type PermDecision } from '../shared/permissions'
import { normalizeSites, siteListed } from '../shared/memory'
import { DEFAULT_THEME, sanitizeSiteTheme, siteKey } from '../shared/sitetheme'
import type { TabKind } from '../shared/tabkind'
import type { SiteCert, SiteInfo, SitePatch } from '../shared/types'
import type { PermissionManager } from './permissions'
import type { SettingsStore } from './settings'
import type { SpaceStore } from './spaces'

/** The page the site settings are about: the active tab. */
export interface ActiveSite {
  url: string
  title: string
  favicon: string | null
  loading: boolean
  spaceId: number
  contentsId: number
  /** The tab's own session: the normal profile's, or a private or Tor one. */
  session: Session
  kind: TabKind
  capture: CaptureState
}

interface Deps {
  settings: SettingsStore
  spaces: SpaceStore
  permissions: PermissionManager
  active: () => ActiveSite | null
  /** How many requests the ad blocker has stopped on the page shown in the given WebContents. */
  blocked: (contentsId: number) => number
  /** How large pages start out in a space (a zoom level). */
  defaultZoom: (spaceId: number) => number
  /** Mute or unmute a whole site. */
  muteSite: (key: string, muted: boolean) => void
  /** Reload the active tab. */
  reload: () => void
  /** Re-apply boosts and zoom after a change. */
  changed: () => void
}

const CERTS_KEPT = 400
/** The certificate each host last presented this run, as Chromium judged it. */
const certs = new Map<string, SiteCert>()

/**
 * Note the certificates sites in `session` present, for the site settings to show. The verdict stays Chromium's
 * (-3 means "use Chromium's own result"); this only looks.
 */
export function watchCertificates(session: Session): void {
  session.setCertificateVerifyProc((req, callback) => {
    const c = req.certificate
    certs.delete(req.hostname) // re-inserted last, so the oldest host is the one dropped
    certs.set(req.hostname, {
      subject: c.subject?.commonName || c.subjectName,
      issuer: c.issuer?.organizations?.[0] || c.issuerName,
      validFrom: c.validStart * 1000,
      validTo: c.validExpiry * 1000,
      ok: req.errorCode === 0
    })
    if (certs.size > CERTS_KEPT) certs.delete(certs.keys().next().value as string)
    callback(-3)
  })
}

/**
 * Everything you can set for one site from the address bar: its permissions, its ad blocker exception, its boost
 * in this space, its zoom, sound and data. A thin layer over the stores that already hold each of those; every
 * write goes through them, so a change shows up wherever else they are shown.
 */
export class SiteSettings {
  constructor(private d: Deps) {}

  async info(): Promise<SiteInfo | null> {
    const page = this.d.active()
    const key = page && siteKey(page.url)
    const origin = page && originOf(page.url)
    if (!page || !key || !origin) return null
    // Everything else is read after this wait, so the state sent includes any change made during it.
    const cookies = await page.session.cookies.get({ url: origin }).catch(() => [])
    const settings = this.d.settings.get()
    const space = this.d.spaces.get(page.spaceId)
    const url = new URL(origin)
    const wc = webContents.fromId(page.contentsId) ?? null
    const { perms, reload } = this.d.permissions.siteState(page.session, origin, wc)
    const secure = url.protocol === 'https:'
    return {
      key,
      origin,
      host: url.host,
      title: page.title,
      favicon: page.favicon,
      loading: page.loading,
      secure,
      cert: secure ? (certs.get(url.hostname) ?? null) : null,
      tabKind: page.kind,
      cookies: cookies.length,
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
      perms,
      reload,
      capture: page.capture
    }
  }

  async update(raw: unknown): Promise<SiteInfo | null> {
    const page = this.d.active()
    const key = page && siteKey(page.url)
    const origin = page && originOf(page.url)
    if (!page || !key || !origin || !raw || typeof raw !== 'object') return this.info()
    const patch = raw as SitePatch
    const settings = this.d.settings.get()
    // A private or Tor tab's answers are its own session's: they never reach the normal profile's.
    const perms = this.d.permissions.storeFor(page.session)

    if (patch.reset === true) {
      const zoom = { ...settings.siteZoom }
      delete zoom[key]
      this.d.settings.update({
        adblockOffSites: settings.adblockOffSites.filter((s) => s !== key),
        adblockCosmeticOffSites: settings.adblockCosmeticOffSites.filter((s) => s !== key),
        neverUnloadSites: settings.neverUnloadSites.filter((s) => s !== key),
        siteZoom: zoom
      })
      if (siteListed(key, settings.mutedSites)) this.d.muteSite(key, false)
      this.d.spaces.setSite(page.spaceId, key, null)
      perms?.set(origin, PERM_KINDS, null)
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
    if (typeof patch.zoom === 'number' && Number.isFinite(patch.zoom)) {
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
    if (patch.clearData === true) await this.clearData(page.session, origin)
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
    if (patch.perm && isPermKind(patch.perm.kind)) {
      const { kind, decision } = patch.perm
      const valid = decision === 'allow' || decision === 'block' ? decision : null
      perms?.set(origin, [kind], valid as PermDecision | null)
    }
    this.d.changed()
    if (patch.reload === true) this.d.reload()
    return this.info()
  }

  /**
   * Forget what the site keeps: its storage, and every cookie it would be sent. Clearing by origin covers the
   * site's own host; cookies set for a parent domain (.example.com) are removed one by one.
   */
  private async clearData(session: Session, origin: string): Promise<void> {
    await session.clearStorageData({ origin }).catch(() => {})
    const left = await session.cookies.get({ url: origin }).catch(() => [])
    await Promise.all(
      left.map((c) => {
        const host = (c.domain ?? '').replace(/^\./, '')
        const url = `${c.secure ? 'https' : 'http'}://${host || new URL(origin).hostname}${c.path ?? '/'}`
        return session.cookies.remove(url, c.name).catch(() => {})
      })
    )
  }
}
