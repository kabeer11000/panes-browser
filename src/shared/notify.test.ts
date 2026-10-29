import { describe, expect, test } from 'bun:test'
import { NOTIFY_PREFIX, NOTIFY_SCRIPT, parseNotify } from './notify'

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

/** Runs the page script against a stand-in window, as a page with the given permission would. */
function runScript(permission: string): {
  installed: boolean
  logs: string[]
  win: Record<string, unknown>
  shown: unknown[][]
} {
  const logs: string[] = []
  const shown: unknown[][] = []
  class FakeNote {
    private listeners: Array<() => void> = []
    constructor(...args: unknown[]) {
      shown.push(args)
    }
    static permission = permission
    addEventListener(_t: string, f: () => void): void {
      this.listeners.push(f)
    }
    click(): void {
      for (const f of this.listeners) f()
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
  const console = { debug: (m: string) => logs.push(m) }
  const installed = new Function('window', 'console', 'return ' + NOTIFY_SCRIPT)(win, console)
  return { installed, logs, win, shown }
}

describe('NOTIFY_SCRIPT', () => {
  test('does nothing for a site that may not notify', () => {
    const r = runScript('default')
    expect(r.installed).toBe(false)
    expect(typeof r.win.Notification).toBe('function')
    expect((r.win.Notification as { permission: string }).permission).toBe('default')
  })

  test('reports shows and clicks, and the real notification is still made', () => {
    const r = runScript('granted')
    expect(r.installed).toBe(true)
    const N = r.win.Notification as new (t: string, o?: object) => { click(): void }
    const n = new N('Ana', { body: 'hello', tag: 't' })
    expect(r.shown).toEqual([['Ana', { body: 'hello', tag: 't' }]])
    n.click()
    expect(r.logs.map((l) => parseNotify(l))).toEqual([
      { kind: 'show', id: 1, title: 'Ana', body: 'hello' },
      { kind: 'click', id: 1 }
    ])
    // statics pass through the proxy
    expect((N as unknown as { permission: string }).permission).toBe('granted')
  })

  test('a service worker notification becomes a page one, without actions', async () => {
    const r = runScript('granted')
    const SWR = r.win.ServiceWorkerRegistration as new () => {
      showNotification(t: string, o?: object): Promise<void>
    }
    await new SWR().showNotification('Call', { body: 'Incoming voice call', actions: [{}] })
    expect(r.shown).toEqual([['Call', { body: 'Incoming voice call' }]])
    expect(parseNotify(r.logs[0])).toEqual({
      kind: 'show',
      id: 1,
      title: 'Call',
      body: 'Incoming voice call'
    })
  })
})
