/**
 * Puts a running Panes under load and measures how it holds up: RAM and CPU per process (via perf-report.ts) and how
 * smooth the interface is (frame times in the main window, which is what "snappy" is made of).
 *
 * Usage (bun):
 *
 *   bun scripts/perf-load.ts [port] [--tabs <n>] [--stress] [--json]
 *
 * `port` is the remote debugging port Panes was started with (default 9222; see scripts/perf-report.ts).
 * --tabs opens that many real sites (default 12, up to the list below). --stress also keeps half of the machine's
 * cores busy for the measurement, which is what a loaded machine looks like to a browser.
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { cpus } from 'os'

const SITES = [
  'https://en.wikipedia.org/wiki/Main_Page',
  'https://news.ycombinator.com',
  'https://github.com/electron/electron',
  'https://www.youtube.com',
  'https://www.reddit.com',
  'https://www.bbc.com',
  'https://developer.mozilla.org/en-US/',
  'https://stackoverflow.com',
  'https://www.nytimes.com',
  'https://www.theverge.com',
  'https://www.amazon.com',
  'https://maps.google.com'
]

const args = process.argv.slice(2)
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 9222)
const tabsIdx = args.indexOf('--tabs')
const tabCount = Math.min(SITES.length, tabsIdx >= 0 ? Number(args[tabsIdx + 1]) || 12 : 12)
const stress = args.includes('--stress')
const asJson = args.includes('--json')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The main window's page: the interface, not a tab. */
async function interfaceTarget(): Promise<string> {
  const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{
    type: string
    url: string
    webSocketDebuggerUrl: string
  }>
  // the dev server's root, or index.html in a built copy (not panes://, which has no window.api)
  const ui = list.find(
    (t) => t.type === 'page' && /^(https?:\/\/localhost:\d+\/?|file:.*\/index\.html)$/.test(t.url.split('#')[0])
  )
  if (!ui) throw new Error(`no interface page on port ${port}`)
  return ui.webSocketDebuggerUrl
}

function session(url: string): Promise<(expression: string, method?: string) => Promise<unknown>> {
  const ws = new WebSocket(url)
  let nextId = 1
  const waiting = new Map<number, (v: unknown) => void>()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data))
    waiting.get(msg.id)?.(msg.result?.result?.value)
  }
  return new Promise((resolve, reject) => {
    ws.onerror = () => reject(new Error('cannot reach the interface page'))
    ws.onopen = () =>
      resolve((expression, method = 'Runtime.evaluate') => {
        const id = nextId++
        return new Promise((res) => {
          waiting.set(id, res)
          ws.send(
            JSON.stringify({
              id,
              method,
              params: { expression, awaitPromise: true, returnByValue: true }
            })
          )
        })
      })
  })
}

/** Frame-to-frame times in the interface over a few seconds, in ms. A smooth 60 Hz interface is 16.7 at every point. */
const FRAMES = (seconds: number): string => `new Promise((resolve) => {
  const t = []; let last = performance.now(); const end = last + ${seconds * 1000}
  // frames do not run in a window that is hidden or covered: say so rather than wait for ever
  const dead = setTimeout(() => resolve({ frames: 0, p50: 0, p95: 0, p99: 0, max: 0 }), ${seconds * 1000 + 3000})
  const tick = (now) => {
    t.push(now - last); last = now
    if (now < end) requestAnimationFrame(tick)
    else { clearTimeout(dead); t.sort((a, b) => a - b); const at = (p) => t[Math.min(t.length - 1, Math.floor(t.length * p))]
      resolve({ frames: t.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: t[t.length - 1] }) }
  }
  requestAnimationFrame(tick)
})`

const busy: ChildProcess[] = []
function startStress(): void {
  const n = Math.max(1, Math.floor(cpus().length / 2))
  for (let i = 0; i < n; i++) {
    busy.push(spawn(process.execPath, ['-e', 'while(true){}'], { stdio: 'ignore' }))
  }
}
const stopStress = (): void => busy.forEach((p) => p.kill())
process.on('exit', stopStress)

const run = await session(await interfaceTarget())
await run('', 'Page.bringToFront')
const quiet = (await run(FRAMES(3))) as Record<string, number>

for (let i = 0; i < tabCount; i++) {
  await run(`window.api.createTab(${JSON.stringify(SITES[i])})`)
  await sleep(500)
}
console.error(`opened ${tabCount} tabs, letting them load...`)
await sleep(25000)
if (stress) startStress()
await sleep(2000)

const loaded = (await run(FRAMES(5))) as Record<string, number>
const report = spawnSync('bun', ['scripts/perf-report.ts', String(port), '--sample', '5', ...(asJson ? ['--json'] : [])], {
  encoding: 'utf8'
})
stopStress()

const fmt = (f: Record<string, number>): string =>
  f.frames === 0
    ? 'no frames ran (is the window covered or minimised?)'
    : `${f.frames} frames  p50 ${f.p50.toFixed(1)}  p95 ${f.p95.toFixed(1)}  p99 ${f.p99.toFixed(1)}  max ${f.max.toFixed(1)} ms`
if (asJson) console.log(JSON.stringify({ tabs: tabCount, stress, quiet, loaded, report: report.stdout.trim() }))
else {
  console.log(`interface frame times, before the tabs:  ${fmt(quiet)}`)
  console.log(`interface frame times, ${tabCount} tabs${stress ? ' + CPU stress' : ''}: ${fmt(loaded)}\n`)
  console.log(report.stdout)
}

// the debugging connection would keep this alive
process.exit(0)
