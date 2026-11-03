/**
 * Which site leaves memory behind? Opens each site alone, waits, closes it, waits, and prints the total private MB
 * of every Panes process before, with the site open, and after closing it. A site whose "after" stays well above
 * "before" is holding memory (renderer, GPU, or a helper service such as audio/video capture).
 *
 *   bun scripts/perf-leak.ts [port] [--sites <url,url,...>] [--wait <seconds>]
 */
import { spawnSync } from 'child_process'

const args = process.argv.slice(2)
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 9222)
const flag = (n: string): string | undefined => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
const waitS = Number(flag('--wait') ?? 12)
const sites = (flag('--sites') ?? 'https://en.wikipedia.org/wiki/Main_Page,https://news.ycombinator.com,https://github.com/electron/electron,https://www.youtube.com,https://www.reddit.com,https://www.bbc.com,https://maps.google.com').split(',')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const ui = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>).find(
  (t) => t.type === 'page' && /^(https?:\/\/localhost:\d+\/?|file:.*\/index\.html)$/.test(t.url.split('#')[0])
)
if (!ui) throw new Error('no interface page')
const ws = new WebSocket(ui.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const waiting = new Map<number, (v: unknown) => void>()
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data))
  waiting.get(m.id)?.(m.result?.result?.value)
}
const run = (expression: string): Promise<unknown> =>
  new Promise((res) => {
    waiting.set(++id, res)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })

function totals(): { mb: number; n: number } {
  const out = spawnSync('bun', [new URL('./perf-report.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), String(port), '--json'], { encoding: 'utf8' })
  const j = JSON.parse(out.stdout.trim().split('\n').pop() ?? '{}')
  return { mb: Math.round(j.totalMb), n: j.processes }
}

const ids = async (): Promise<string[]> => JSON.parse((await run(`window.api.getState().then((s) => JSON.stringify(s.state.tabs.map((t) => t.id)))`)) as string)

console.log('site'.padEnd(44), 'before', 'open', 'after', 'kept MB', 'procs before/after')
for (const url of sites) {
  await sleep(3000)
  const before = totals()
  const had = new Set(await ids())
  await run(`window.api.createTab(${JSON.stringify(url)})`)
  await sleep(waitS * 1000)
  const open = totals()
  for (const t of await ids()) if (!had.has(t)) await run(`window.api.closeTab(${JSON.stringify(t)})`)
  await sleep(waitS * 1000)
  const after = totals()
  console.log(url.padEnd(44), String(before.mb).padStart(6), String(open.mb).padStart(4), String(after.mb).padStart(5), String(after.mb - before.mb).padStart(7), `${before.n}/${after.n}`)
}
ws.close()
