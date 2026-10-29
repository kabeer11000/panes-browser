import {
  ipcMain,
  safeStorage,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { randomInt } from 'crypto'
import { loginsFromCsv, loginsToCsv, type LoginRow } from '../shared/csv'
import { classify, generatePassword, normalizeOrigin, type SaveDecision } from '../shared/passwords'
import type { LoginInput, LoginSummary, PasswordPrompt } from '../shared/types'
import { parseAnchor } from '../shared/anchor'
import { PromptPopover } from './popover'
import { JsonStore } from './store'

const MAX_FIELD = 2000

interface Entry {
  id: number
  origin: string
  username: string
  /** The password, encrypted with the operating system's keychain (DPAPI, Keychain, libsecret), base64. */
  secret: string
  created: number
  updated: number
}

interface Data {
  next: number
  entries: Entry[]
  /** Sites the user chose never to be asked about. */
  never: string[]
}

/** Saved logins. Passwords are encrypted at rest; nothing is ever stored in plain text. */
export class PasswordStore {
  private store = new JsonStore<Data>('passwords', { next: 1, entries: [], never: [] })

  private get data(): Data {
    return this.store.value
  }

  /** False when the OS has no keychain to protect passwords with: we refuse to store them then. */
  get available(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  private reveal(e: Entry): string {
    return safeStorage.decryptString(Buffer.from(e.secret, 'base64'))
  }

  private seal(password: string): string {
    return safeStorage.encryptString(password).toString('base64')
  }

  list(): LoginSummary[] {
    return this.data.entries
      .map(({ id, origin, username, updated }) => ({ id, origin, username, updated }))
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username))
  }

  /** The accounts saved for one site, without their passwords. */
  accounts(origin: string): Array<{ id: number; username: string }> {
    return this.data.entries
      .filter((e) => e.origin === origin)
      .map(({ id, username }) => ({ id, username }))
  }

  /** A login's credentials, only if it belongs to `origin`: a page can never read another site's. */
  credentials(origin: string, id: number): { username: string; password: string } | null {
    const e = this.data.entries.find((x) => x.id === id && x.origin === origin)
    return e ? { username: e.username, password: this.reveal(e) } : null
  }

  password(id: number): string | null {
    const e = this.data.entries.find((x) => x.id === id)
    return e ? this.reveal(e) : null
  }

  decide(origin: string, username: string, password: string): SaveDecision {
    const saved = this.data.entries
      .filter((e) => e.origin === origin)
      .map((e) => ({ username: e.username, password: this.reveal(e) }))
    return classify(saved, username, password)
  }

  /** Adds a login, or replaces the password of the one with the same site and username. */
  upsert(origin: string, username: string, password: string): 'added' | 'updated' | null {
    if (
      !this.available ||
      !password ||
      password.length > MAX_FIELD ||
      username.length > MAX_FIELD
    ) {
      return null
    }
    const now = Date.now()
    const secret = this.seal(password)
    const existing = this.data.entries.find((e) => e.origin === origin && e.username === username)
    if (existing) {
      existing.secret = secret
      existing.updated = now
    } else {
      this.data.entries.push({
        id: this.data.next++,
        origin,
        username,
        secret,
        created: now,
        updated: now
      })
    }
    this.store.save()
    return existing ? 'updated' : 'added'
  }

  edit(id: number, username: string, password: string): boolean {
    const e = this.data.entries.find((x) => x.id === id)
    if (
      !e ||
      !this.available ||
      !password ||
      password.length > MAX_FIELD ||
      username.length > MAX_FIELD
    ) {
      return false
    }
    // renaming onto another saved account of the same site would leave two identical logins
    if (
      this.data.entries.some((x) => x.id !== id && x.origin === e.origin && x.username === username)
    ) {
      return false
    }
    e.username = username
    e.secret = this.seal(password)
    e.updated = Date.now()
    this.store.save()
    return true
  }

  remove(id: number): void {
    this.data.entries = this.data.entries.filter((e) => e.id !== id)
    this.store.save()
  }

  isNever(origin: string): boolean {
    return this.data.never.includes(origin)
  }

  addNever(origin: string): void {
    if (!this.isNever(origin)) this.data.never.push(origin)
    this.store.save()
  }

  importCsv(csv: string): { added: number; skipped: number } {
    const { rows, skipped } = loginsFromCsv(csv)
    let added = 0
    let failed = 0
    for (const r of rows) {
      if (this.upsert(r.origin, r.username, r.password)) added++
      else failed++
    }
    return { added, skipped: skipped + failed }
  }

  exportCsv(): string {
    const rows: LoginRow[] = this.data.entries.map((e) => ({
      origin: e.origin,
      username: e.username,
      password: this.reveal(e)
    }))
    return loginsToCsv(rows)
  }
}

/** The site a message came from, or null for anything that is not the top frame of a web page. */
function siteOf(e: IpcMainEvent | IpcMainInvokeEvent): string | null {
  const frame = e.senderFrame
  if (!frame || frame !== e.sender.mainFrame) return null
  return normalizeOrigin(frame.url)
}

/**
 * IPC between web pages (autofill script in each tab), the browser window (save bar) and the store.
 * The site is always taken from the sender, never from what the page claims.
 */
export function registerPasswordIpc(win: BrowserWindow, store: PasswordStore): void {
  let pending: (PasswordPrompt & { password: string }) | null = null
  // With the sidebar closed the prompt hangs under the address bar in a view of its own.
  const popover = new PromptPopover(win)
  const fromUi = (e: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    e.sender === win.webContents || e.sender === popover.contents
  const tell = (p: PasswordPrompt | null): void => {
    if (!win.isDestroyed()) win.webContents.send('pw:prompt', p)
    popover.setPrompt(p)
  }

  ipcMain.on('pw:anchor', (e, raw: unknown) => {
    if (e.sender === win.webContents) popover.setAnchor(parseAnchor(raw))
  })
  ipcMain.handle('popover:state', (e) => (e.sender === popover.contents ? popover.state() : null))
  ipcMain.on('popover:resize', (e, height: unknown) => {
    if (e.sender === popover.contents && typeof height === 'number') popover.setHeight(height)
  })

  // Many sites ask for the account first and the password on the next step (or screen). The first step's
  // value is remembered here, per site, for a few minutes, and used when the password step names no user.
  const identifiers = new Map<string, { value: string; at: number }>()
  const IDENTIFIER_TTL_MS = 5 * 60_000
  ipcMain.on('pw:identifier', (e, value: unknown) => {
    const origin = siteOf(e)
    if (!origin || typeof value !== 'string') return
    const v = value.trim().slice(0, 256)
    if (v) identifiers.set(origin, { value: v, at: Date.now() })
    else identifiers.delete(origin)
  })

  ipcMain.on('pw:submit', (e, typed: unknown, password: unknown) => {
    const origin = siteOf(e)
    if (!origin || typeof typed !== 'string' || typeof password !== 'string') return
    if (!password || !store.available || store.isNever(origin)) return
    const earlier = identifiers.get(origin)
    const username =
      typed || (earlier && Date.now() - earlier.at < IDENTIFIER_TTL_MS ? earlier.value : '')
    const decision = store.decide(origin, username, password)
    if (decision === 'same') return
    pending = { origin, username, password, kind: decision }
    tell({ origin, username, kind: decision })
  })

  ipcMain.handle('pw:accounts', (e) => {
    const origin = siteOf(e)
    return origin ? store.accounts(origin) : []
  })
  ipcMain.handle('pw:fill', (e, id: unknown) => {
    const origin = siteOf(e)
    return origin && typeof id === 'number' ? store.credentials(origin, id) : null
  })

  // Only on request: the save prompt can show what is about to be saved, but the password never rides along with it.
  ipcMain.handle('pw:reveal-pending', (e) => (fromUi(e) ? (pending?.password ?? null) : null))

  ipcMain.on('pw:answer', (e, answer: 'save' | 'never' | 'dismiss', edits?: unknown) => {
    if (!fromUi(e) || !pending) return
    const { origin, username, password } = pending
    pending = null
    // The prompt lets the user correct what the page filled in; only well-formed edits count.
    const edited = edits as { username?: unknown; password?: unknown } | null | undefined
    const finalUser =
      typeof edited?.username === 'string' ? edited.username.trim().slice(0, 256) : username
    const finalPassword =
      typeof edited?.password === 'string' && edited.password !== ''
        ? edited.password.slice(0, 1024)
        : password
    if (answer === 'save') {
      store.upsert(origin, finalUser, finalPassword)
      identifiers.delete(origin)
    } else if (answer === 'never') store.addNever(origin)
    tell(null)
  })
}

export const newPassword = (): string => generatePassword((max) => randomInt(max))

export type { LoginInput }
