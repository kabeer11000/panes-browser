import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { release, totalmem } from 'os'
import { hasUsage, ramTier, type UsageBatch } from '@shared/share/usage'
import { JsonStore } from './store'

/**
 * Usage statistics (shared/share/usage.ts), only while the person has said yes (`usageStats`). Counts gather in a
 * store (so a quit or crash loses nothing) and go to the relay every half hour; while it is off nothing is counted
 * and what was gathered is dropped.
 */
const SEND_MS = 30 * 60_000

interface Saved {
  id: string
  batch: Omit<UsageBatch, 'id' | 'v' | 'os' | 'ram'>
}
const empty = (): Saved['batch'] => ({ active: 0, actions: {}, sites: {} })

// made by startUsage (a store reads its file when made: not during import); nothing counts before then
let store!: JsonStore<Saved>
let enabled = (): boolean => false

const bump = (m: Record<string, number>, k: string, n: number): void => {
  m[k] = (m[k] ?? 0) + n
}
function count(f: (b: Saved['batch']) => void): void {
  if (!enabled()) return
  f(store.value.batch)
  store.save()
}

/**
 * Count every command the windows send main, by channel name (never its arguments). Must run before the
 * `register*` calls; nothing in main removes an IPC listener, so wrapping them changes nothing else.
 */
export function countIpc(): void {
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (ch, fn) =>
    handle(ch, (e, ...a) => {
      count((b) => bump(b.actions, ch, 1))
      return fn(e, ...a)
    })
  const on = ipcMain.on.bind(ipcMain)
  ipcMain.on = (ch, fn) =>
    on(ch, (e, ...a) => {
      count((b) => bump(b.actions, ch, 1))
      fn(e, ...a)
    })
}

/** Seconds a site was in front and in use (from screen time's tick, which already skips private and Tor). */
export const countSite = (site: string, seconds: number): void =>
  count((b) => {
    b.active += seconds
    bump(b.sites, site, seconds)
  })

/**
 * A screen shown: the board, the tab view, the board's preview, one of Panes' own pages. Counted with the commands,
 * as `screen:<name>` (the batch's key format allows it), so no new field is needed anywhere.
 */
export const countScreen = (name: string): void =>
  count((b) => bump(b.actions, 'screen:' + name, 1))

let booted = false
/** How long this start took, launch to the window's page loaded (the first load only: not a reload). */
export function countBoot(ms: number): void {
  if (booted) return
  booted = true
  count((b) => (b.boot = Math.round(ms)))
}

export function startUsage(o: { on: () => boolean; version: string; relay: string }): void {
  store = new JsonStore<Saved>('usage', { id: '', batch: empty() })
  enabled = o.on
  const send = async (): Promise<void> => {
    if (!o.on()) {
      if (hasUsage({ id: '', v: '', os: '', ram: 0, ...store.value.batch })) {
        store.value = { ...store.value, batch: empty() }
        store.save()
      }
      return
    }
    if (!store.value.id) store.value = { ...store.value, id: randomUUID() }
    const batch: UsageBatch = {
      id: store.value.id,
      v: o.version,
      os: `${process.platform} ${release()}`,
      ram: ramTier(totalmem()),
      ...store.value.batch
    }
    if (!hasUsage(batch)) return
    // a fresh batch takes what comes in meanwhile; this one goes back into it unless it was taken
    const sent = store.value.batch
    store.value = { ...store.value, batch: empty() }
    let done = false
    try {
      const res = await fetch(`${o.relay}/usage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch)
      })
      done = res.ok || res.status === 400 || res.status === 413 // taken, or refused for good
    } catch {
      // offline: it all goes next time
    }
    if (!done) {
      const b = store.value.batch
      b.active += sent.active
      b.boot ??= sent.boot
      for (const [k, n] of Object.entries(sent.actions)) bump(b.actions, k, n)
      for (const [k, n] of Object.entries(sent.sites)) bump(b.sites, k, n)
    }
    store.save()
  }
  setTimeout(() => void send(), 60_000).unref() // what an earlier run left, once things have settled
  setInterval(() => void send(), SEND_MS).unref()
}
