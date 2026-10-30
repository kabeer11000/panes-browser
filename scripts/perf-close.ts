/**
 * How long closing tabs takes, closed one after another as fast as a person can click: from the close request until
 * the interface is told the tab is gone. Run it against a Panes with tabs open (scripts/perf-load.ts opens some).
 *
 *   bun scripts/perf-close.ts [port] [--gap <ms>] [--keep <n>]
 *
 * --gap is the pause between closes (default 40, about a very fast clicker); --keep leaves that many tabs open.
 */
const args = process.argv.slice(2)
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 9222)
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) || fallback : fallback
}
const gap = flag('--gap', 40)
const keep = flag('--keep', 1)

const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{
  type: string
  url: string
  webSocketDebuggerUrl: string
}>
// the interface page: the dev server's root, or index.html in a built copy (not panes://, which has no window.api)
const ui = list.find(
  (t) => t.type === 'page' && /^(https?:\/\/localhost:\d+\/?|file:.*\/index\.html)$/.test(t.url.split('#')[0])
)
if (!ui) throw new Error(`no interface page on port ${port}`)
const ws = new WebSocket(ui.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data))
  if (m.id === 1) {
    if (m.result?.exceptionDetails) console.error(m.result.exceptionDetails.exception?.description)
    else console.log(m.result.result.value)
    ws.close()
  }
}

// runs in the interface page, which hears the same state updates the user's screen is drawn from
const expression = `(async () => {
  let state = null
  const waiting = new Map()
  window.api.onState((s) => {
    state = s
    const ids = new Set(s.tabs.map((t) => t.id))
    for (const [id, done] of waiting) if (!ids.has(id)) { waiting.delete(id); done(performance.now()) }
  })
  state = (await window.api.getState()).state
  const ids = state.tabs.filter((t) => !t.pinned).map((t) => t.id).slice(0, Math.max(0, state.tabs.length - ${keep}))
  const times = []
  const started = performance.now()
  const pending = []
  for (const id of ids) {
    const t0 = performance.now()
    pending.push(new Promise((res) => waiting.set(id, (t1) => { times.push(t1 - t0); res() })))
    window.api.closeTab(id)
    await new Promise((r) => setTimeout(r, ${gap}))
  }
  await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 10000))])
  const total = performance.now() - started
  times.sort((a, b) => a - b)
  const at = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))]
  return JSON.stringify({ closed: times.length, of: ids.length, gapMs: ${gap}, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)), max: Math.round(times[times.length - 1] ?? 0), totalMs: Math.round(total) })
})()`
ws.send(
  JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true }
  })
)
