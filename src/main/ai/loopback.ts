import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'

const PAGE = (title: string, body: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f6f6f6;color:#222}main{text-align:center;max-width:26em;padding:2em}h1{font-size:1.25em;margin:0 0 .5em}p{margin:0;color:#666}@media(prefers-color-scheme:dark){body{background:#1b1b1b;color:#eee}p{color:#aaa}}</style><main><h1>${title}</h1><p>${body}</p></main>`

export interface Loopback {
  port: number
  /** Resolves with the query of the one request that reaches `path`; rejects on timeout or cancel. */
  result: Promise<URLSearchParams>
  cancel(): void
}

/**
 * A one-shot HTTP listener on 127.0.0.1 for an OAuth redirect. It answers only GET on the exact path, only for
 * a loopback Host header (a page cannot reach it through a rebinding name), and closes after the first hit.
 */
export function listenOnce(path: string, timeoutMs: number): Promise<Loopback> {
  return new Promise((resolveStart, rejectStart) => {
    let done: (v: URLSearchParams) => void = () => undefined
    let fail: (e: Error) => void = () => undefined
    const result = new Promise<URLSearchParams>((res, rej) => {
      done = res
      fail = rej
    })
    result.catch(() => undefined) // a cancelled sign-in is not an unhandled rejection
    let server: Server | null = null
    let timer: NodeJS.Timeout | null = null
    const close = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      server?.close()
      server?.closeAllConnections()
      server = null
    }
    server = createServer((req, res) => {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '')
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (
        req.method !== 'GET' ||
        url.pathname !== path ||
        !['127.0.0.1', 'localhost'].includes(host)
      ) {
        res.writeHead(404).end()
        return
      }
      const failed = url.searchParams.has('error')
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      })
      res.end(
        failed
          ? PAGE('Sign-in did not finish', 'You can close this tab and return to Panes.')
          : PAGE('You are signed in', 'You can close this tab and return to Panes.')
      )
      done(url.searchParams)
      close()
    })
    server.once('error', rejectStart)
    server.listen(0, '127.0.0.1', () => {
      timer = setTimeout(() => {
        fail(new Error('Sign-in timed out. Try again.'))
        close()
      }, timeoutMs)
      resolveStart({
        port: (server?.address() as AddressInfo).port,
        result,
        cancel: () => {
          fail(new Error('Sign-in was cancelled.'))
          close()
        }
      })
    })
  })
}
