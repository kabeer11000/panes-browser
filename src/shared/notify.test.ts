import { describe, expect, test } from 'bun:test'
import { NOTIFY_PREFIX, notifyShim, parseNotify } from './notify'

const msg = (v: unknown): string => NOTIFY_PREFIX + JSON.stringify(v)

describe('parseNotify', () => {
  test('reads a shown notification', () => {
    expect(parseNotify(msg({ kind: 'show', id: 3, title: 'Ana', body: 'hi' }))).toEqual({
      kind: 'show',
      id: 3,
      title: 'Ana',
      body: 'hi'
    })
  })
  test('reads a click', () => {
    expect(parseNotify(msg({ kind: 'click', id: 1 }))).toEqual({ kind: 'click', id: 1 })
  })
  test('ignores other messages, garbage and bad ids', () => {
    expect(parseNotify('hello')).toBeNull()
    expect(parseNotify(NOTIFY_PREFIX + '{nope')).toBeNull()
    expect(parseNotify(NOTIFY_PREFIX + 'null')).toBeNull()
    expect(parseNotify(msg({ kind: 'click', id: '1' }))).toBeNull()
    expect(parseNotify(msg({ kind: 'click', id: 0 }))).toBeNull()
    expect(parseNotify(msg({ kind: 'click', id: 1.5 }))).toBeNull()
    expect(parseNotify(msg({ kind: 'other', id: 1 }))).toBeNull()
  })
  test('text that is not a string is empty, long text is cut', () => {
    const r = parseNotify(msg({ kind: 'show', id: 1, title: 5, body: 'x'.repeat(1000) }))
    expect(r).toEqual({ kind: 'show', id: 1, title: '', body: 'x'.repeat(300) })
  })
})

/** Runs the shim against a stand-in window: what it reported, and the notifications really made. */
function runShim(): {
  reports: Array<ReturnType<typeof parseNotify>>
  win: Record<string, unknown>
  shown: unknown[][]
} {
  const reports: Array<ReturnType<typeof parseNotify>> = []
  const shown: unknown[][] = []
  class FakeNote {
    private listeners: Array<(e: { isTrusted: boolean }) => void> = []
    constructor(...args: unknown[]) {
      shown.push(args)
    }
    static permission = 'granted'
    addEventListener(_t: string, f: (e: { isTrusted: boolean }) => void): void {
      this.listeners.push(f)
    }
    /** A click: from the toast (trusted), or one the page made up. */
    click(isTrusted = true): void {
      for (const f of this.listeners) f({ isTrusted })
    }
  }
  class FakeSWR {
    showNotification(): Promise<void> {
      return Promise.reject(new Error('original should not run'))
    }
  }
  const win: Record<string, unknown> = {
    Notification: FakeNote,
    ServiceWorkerRegistration: FakeSWR
  }
  notifyShim(
    { report: (d) => reports.push(parseNotify(NOTIFY_PREFIX + d)) },
    win as unknown as typeof globalThis
  )
  return { reports, win, shown }
}

describe('notifyShim', () => {
  test('reports shows and toast clicks, and the real notification is still made', () => {
    const r = runShim()
    const N = r.win.Notification as new (t: string, o?: object) => { click(t?: boolean): void }
    const n = new N('Ana', { body: 'hello', tag: 't' })
    expect(r.shown).toEqual([['Ana', { body: 'hello', tag: 't' }]])
    n.click()
    expect(r.reports).toEqual([
      { kind: 'show', id: 1, title: 'Ana', body: 'hello' },
      { kind: 'click', id: 1 }
    ])
    // statics pass through the proxy
    expect((N as unknown as { permission: string }).permission).toBe('granted')
  })

  test('a click the page makes up does not bring its tab forward', () => {
    const r = runShim()
    const N = r.win.Notification as new (t: string) => { click(t?: boolean): void }
    new N('Fake').click(false)
    expect(r.reports.map((x) => x?.kind)).toEqual(['show'])
  })

  test('each notification has its own id', () => {
    const r = runShim()
    const N = r.win.Notification as new (t: string) => { click(): void }
    const a = new N('a')
    new N('b').click()
    a.click()
    expect(r.reports.filter((x) => x?.kind === 'click')).toEqual([
      { kind: 'click', id: 2 },
      { kind: 'click', id: 1 }
    ])
  })

  test('a service worker notification becomes a page one, without actions', async () => {
    const r = runShim()
    const SWR = r.win.ServiceWorkerRegistration as new () => {
      showNotification(t: string, o?: object): Promise<void>
    }
    await new SWR().showNotification('Call', { body: 'Incoming voice call', actions: [{}] })
    expect(r.shown).toEqual([['Call', { body: 'Incoming voice call' }]])
    expect(r.reports[0]).toEqual({
      kind: 'show',
      id: 1,
      title: 'Call',
      body: 'Incoming voice call'
    })
  })
})

describe('service worker notifications', () => {
  test('a worker showing one reports it (title, body, where it goes) and does not throw', async () => {
    const { swNotifyShim } = await import('./swNotify')
    const got: unknown[] = []
    class SWR {
      showNotification(): Promise<void> {
        throw new Error('the original is not used')
      }
    }
    const g = { ServiceWorkerRegistration: SWR } as unknown as typeof globalThis
    swNotifyShim({ report: (n) => got.push(n) }, g)
    await new SWR().showNotification('Ana', {
      body: 'Are you there?',
      data: { url: 'https://chat.example/c/1' }
    } as NotificationOptions)
    await new SWR().showNotification('Plain')
    expect(got).toEqual([
      { title: 'Ana', body: 'Are you there?', url: 'https://chat.example/c/1' },
      { title: 'Plain', body: '', url: null }
    ])
  })

  test('reports are checked: no title, no report; only web addresses to go to; long text cut', async () => {
    const { parseWorkerNote } = await import('./swNotify')
    expect(parseWorkerNote(null)).toBeNull()
    expect(parseWorkerNote({ body: 'x' })).toBeNull()
    expect(parseWorkerNote({ title: 'T', url: 'javascript:alert(1)' })?.url).toBeNull()
    expect(parseWorkerNote({ title: 'x'.repeat(5000) })?.title.length).toBe(300)
  })
})
