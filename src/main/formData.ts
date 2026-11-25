import {
  ipcMain,
  safeStorage,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import {
  addressLabel,
  addressSub,
  cardLabel,
  cardSub,
  EMPTY_ADDRESS,
  EMPTY_CARD,
  fromSubmitted,
  sameAddress,
  sameCard,
  validCardNumber,
  type Address,
  type Card,
  type FieldKind
} from '@shared/formFill'
import type { FormEntry, FormEntrySummary } from '@shared/types'
import { handleInternal } from './internal'
import type { PermissionManager } from './permissions'
import { JsonStore } from './store'

interface Stored {
  id: number
  kind: 'address' | 'card'
  /** The address or card as JSON, encrypted with the operating system's keychain, base64. */
  secret: string
  updated: number
}

interface Data {
  next: number
  entries: Stored[]
}

const MAX_ENTRIES = 200
const MAX_FIELD = 300

/** Only the known fields, as short text: what a page or the settings page sends is never trusted as it is. */
function clean<T extends object>(shape: T, raw: unknown): T {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = { ...shape } as Record<string, string>
  for (const k of Object.keys(shape)) {
    const v = o[k]
    if (typeof v === 'string') out[k] = v.slice(0, MAX_FIELD)
  }
  return out as T
}

/** Saved addresses and payment cards. Encrypted at rest, as passwords are; nothing is kept when there is no keychain. */
export class FormDataStore {
  private store = new JsonStore<Data>('autofill', { next: 1, entries: [] })

  get available(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  private open(e: Stored): Address | Card | null {
    try {
      const raw: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(e.secret, 'base64')))
      return e.kind === 'card' ? clean(EMPTY_CARD, raw) : clean(EMPTY_ADDRESS, raw)
    } catch {
      return null // sealed on another account or machine
    }
  }

  private seal(value: Address | Card): string {
    return safeStorage.encryptString(JSON.stringify(value)).toString('base64')
  }

  all(): FormEntry[] {
    return this.store.value.entries.flatMap((e) => {
      const value = this.open(e)
      return value
        ? [
            e.kind === 'card'
              ? { id: e.id, kind: 'card' as const, card: value as Card }
              : { id: e.id, kind: 'address' as const, address: value as Address }
          ]
        : []
    })
  }

  /** What a page's menu lists: never a card's whole number. */
  summaries(kind: 'address' | 'card'): FormEntrySummary[] {
    return this.all()
      .filter((e) => e.kind === kind)
      .map((e) =>
        e.kind === 'card'
          ? { id: e.id, label: cardLabel(e.card), sub: cardSub(e.card) }
          : { id: e.id, label: addressLabel(e.address), sub: addressSub(e.address) }
      )
  }

  get(id: number): FormEntry | null {
    return this.all().find((e) => e.id === id) ?? null
  }

  /** Adds one, or changes the one with `id`. False when it cannot be kept (no keychain, a bad card number). */
  save(entry: { id?: number; kind: 'address' | 'card'; value: unknown }): boolean {
    if (!this.available) return false
    const value =
      entry.kind === 'card' ? clean(EMPTY_CARD, entry.value) : clean(EMPTY_ADDRESS, entry.value)
    if (entry.kind === 'card') {
      const c = value as Card
      c.number = c.number.replace(/\D/g, '')
      if (!validCardNumber(c.number)) return false
    } else if (!Object.values(value).some((v) => v.trim())) return false
    const d = this.store.value
    const at = d.entries.find((e) => e.id === entry.id && e.kind === entry.kind)
    if (at) {
      at.secret = this.seal(value)
      at.updated = Date.now()
    } else {
      if (d.entries.length >= MAX_ENTRIES) return false
      d.entries.push({
        id: d.next++,
        kind: entry.kind,
        secret: this.seal(value),
        updated: Date.now()
      })
    }
    this.store.save()
    return true
  }

  remove(id: number): void {
    this.store.value.entries = this.store.value.entries.filter((e) => e.id !== id)
    this.store.save()
  }

  /** Whether this address or card is saved already (it is not offered again). */
  has(value: Address | Card, kind: 'address' | 'card'): boolean {
    return this.all().some((e) =>
      kind === 'card'
        ? e.kind === 'card' && sameCard(e.card, value as Card)
        : e.kind === 'address' && sameAddress(e.address, value as Address)
    )
  }
}

/** Where a page's message came from, if autofill works there: not a private or Tor tab, not a tab shown live. */
function usable(
  e: IpcMainEvent | IpcMainInvokeEvent,
  live: (wc: WebContents) => boolean
): { secure: boolean } | null {
  if (live(e.sender) || e.sender.session.storagePath === null) return null
  const url = e.senderFrame?.url ?? ''
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  // a card is only offered and filled over https (a payment form in an http page could be read by anyone between)
  const secure = u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  return { secure }
}

const FIELD_KINDS = new Set<string>([
  'name',
  'given-name',
  'family-name',
  'organization',
  'street',
  'line1',
  'line2',
  'city',
  'state',
  'postal',
  'country',
  'phone',
  'email',
  'cc-name',
  'cc-number',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year'
])

/**
 * IPC for pages (the fill menu in preload/formFill.ts, and what a submitted form held) and for panes://passwords.
 * Saving is asked on Panes' own card, in the page's tab.
 */
export function registerFormData(
  store: FormDataStore,
  d: {
    permissions: PermissionManager
    live: (wc: WebContents) => boolean
    /** The setting (formFill): off, nothing is offered, filled or asked about. */
    on: () => boolean
  }
): void {
  ipcMain.handle('ff:offers', (e, kind: unknown) => {
    const at = d.on() ? usable(e, d.live) : null
    if (!at || (kind !== 'address' && kind !== 'card')) return []
    if (kind === 'card' && !at.secure) return []
    return store.summaries(kind)
  })
  ipcMain.handle('ff:fill', (e, id: unknown) => {
    const at = d.on() ? usable(e, d.live) : null
    if (!at || typeof id !== 'number') return null
    const entry = store.get(id)
    if (!entry || (entry.kind === 'card' && !at.secure)) return null
    return entry
  })

  // one question at a time per tab: a form sent twice (a double click) is not asked about twice
  const asking = new Set<WebContents>()
  ipcMain.on('ff:submit', (e, raw: unknown) => {
    const at = d.on() ? usable(e, d.live) : null
    if (!at || !store.available || !Array.isArray(raw) || asking.has(e.sender)) return
    const fields = raw
      .slice(0, 60)
      .filter(
        (f): f is { kind: FieldKind; value: string } =>
          !!f && FIELD_KINDS.has(f.kind) && typeof f.value === 'string'
      )
    const got = fromSubmitted(fields)
    const card = at.secure && got.card && !store.has(got.card, 'card') ? got.card : null
    const address = got.address && !store.has(got.address, 'address') ? got.address : null
    if (!card && !address) return
    const wc = e.sender
    asking.add(wc)
    const ask = async (): Promise<void> => {
      if (card) {
        const pick = await d.permissions.confirm(
          {
            title: 'Save this card?',
            detail: `${cardLabel(card)}${cardSub(card) ? `, ${cardSub(card).toLowerCase()}` : ''}. Kept encrypted on this computer, without its security code.`,
            choices: [{ label: 'Not now' }, { label: 'Save', tone: 'primary' }]
          },
          wc
        )
        if (pick === 1) store.save({ kind: 'card', value: card })
      }
      if (address && !wc.isDestroyed()) {
        const pick = await d.permissions.confirm(
          {
            title: 'Save this address?',
            detail: [addressLabel(address), addressSub(address)].filter(Boolean).join(', '),
            choices: [{ label: 'Not now' }, { label: 'Save', tone: 'primary' }]
          },
          wc
        )
        if (pick === 1) store.save({ kind: 'address', value: address })
      }
    }
    void ask().finally(() => asking.delete(wc))
  })

  handleInternal('int:formdata-list', () => store.all())
  handleInternal(
    'int:formdata-save',
    (entry: { id?: number; kind: 'address' | 'card'; value: unknown }) =>
      entry && (entry.kind === 'address' || entry.kind === 'card') ? store.save(entry) : false
  )
  handleInternal('int:formdata-remove', (id: number) => store.remove(Number(id)))
}
