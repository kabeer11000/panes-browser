import { describe, expect, test } from 'bun:test'
import * as Y from 'yjs'
import { ShareClient } from './client'

/** A WebSocket that never gets through: every try closes as a dropped connection (1006). */
function deadSocket(opened: { n: number }): typeof WebSocket {
  return class {
    binaryType = 'arraybuffer'
    readyState = 0
    onopen: (() => void) | null = null
    onclose: ((e: { code: number }) => void) | null = null
    onmessage: (() => void) | null = null
    constructor() {
      opened.n++
      queueMicrotask(() => this.onclose?.({ code: 1006 }))
    }
    send(): void {
      // nothing gets through
    }
    close(): void {
      // already closed
    }
  } as unknown as typeof WebSocket
}

describe('ShareClient reconnecting', () => {
  test('keeps trying while the relay is unreachable (a redeploy outlasts five tries)', async () => {
    const opened = { n: 0 }
    const real = globalThis.setTimeout
    // backoff waits run at once, so many tries fit in the test
    globalThis.setTimeout = ((fn: () => void) => real(fn, 0)) as typeof setTimeout
    try {
      const c = new ShareClient({
        relay: 'https://relay.test',
        room: 'r'.repeat(22),
        secret: 's'.repeat(43),
        doc: new Y.Doc(),
        WebSocketImpl: deadSocket(opened)
      })
      for (let i = 0; i < 200 && opened.n < 12; i++) await new Promise((r) => real(r, 5))
      expect(opened.n).toBeGreaterThanOrEqual(12)
      expect(c.status).not.toBe('refused')
      c.destroy()
    } finally {
      globalThis.setTimeout = real
    }
  })
})
