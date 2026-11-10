/**
 * How smooth the canvas board is: frame times and main-thread work in the interface while it pans, zooms, drags a
 * card and opens/closes a preview. Run against a Panes started with a debugging port, on a scratch profile:
 *
 *   PANES_USERDATA=E:/tmp/panes-perf REMOTE_DEBUGGING_PORT=9336 bun run dev
 *   bun scripts/perf-canvas.ts [port] [--tabs 60] [--throttle 1,4] [--json]
 *
 * --tabs    how many tabs to put on the board first (light pages; opened once, kept on the profile)
 * --throttle CPU slow-down factors to run at (CDP Emulation.setCPUThrottlingRate); 4 stands in for an older laptop
 *
 * Per gesture: frames (p50/p95/max ms, frames over 33 ms) from a rAF sampler in the interface, and the interface's
 * script, layout and style time from Performance.getMetrics. Leaves the board open.
 */

const args = process.argv.slice(2)
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 9336)
const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? (args[i + 1] ?? def) : def
}
const TABS = Number(opt('tabs', '60'))
const THROTTLES = opt('throttle', '1,4').split(',').map(Number)
const asJson = args.includes('--json')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{
  type: string
  url: string
  webSocketDebuggerUrl: string
}>
const ui = targets.find(
  (t) => t.type === 'page' && (/\/index\.html/.test(t.url) || /^http:\/\/localhost:\d+\/$/.test(t.url))
)
if (!ui) throw new Error(`no interface page on port ${port}`)

const ws = new WebSocket(ui.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let seq = 0
const waiting = new Map<number, (v: Record<string, unknown>) => void>()
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data)) as { id?: number; result?: Record<string, unknown> }
  if (m.id !== undefined) waiting.get(m.id)?.(m.result ?? {})
}
const send = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    const id = ++seq
    waiting.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async <T>(expression: string): Promise<T> =>
  ((await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as {
    result: { value: T }
  }).result.value

await send('Performance.enable')

// ---- set up: tabs, then the board ----
const have = await evaluate<number>('window.api.getState().then((s) => (s.tabs ?? s.state?.tabs ?? []).length)')
for (let i = have; i < TABS; i++) {
  await evaluate(`window.api.createTab('https://example.com/?panes-perf=${i}')`)
  await sleep(120)
}
await sleep(3000)
const onBoard = async (): Promise<boolean> => evaluate<boolean>('!!document.querySelector(".cv")')
if (!(await onBoard())) {
  // Ctrl+Shift+K is a main-process shortcut, which synthetic keys do not reach: the toolbar's button is
  await evaluate(`document.querySelector('button[aria-label="Canvas"]')?.click()`)
  for (let i = 0; i < 40 && !(await onBoard()); i++) await sleep(250)
}
if (!(await onBoard())) throw new Error('the board did not open (Canvas button)')
await sleep(2500)
const cards = await evaluate<number>('document.querySelectorAll(".cv-card").length')

// ---- measuring ----
const startFrames = (): Promise<unknown> =>
  evaluate(`(() => { window.__f = []; let last = performance.now(); const tick = (t) => { window.__f.push(t - last); last = t; if (window.__f) window.__fr = requestAnimationFrame(tick) }; window.__fr = requestAnimationFrame(tick) })()`)
const stopFrames = (): Promise<number[]> =>
  evaluate<number[]>(`(() => { cancelAnimationFrame(window.__fr); const f = window.__f.slice(1); window.__f = null; return f })()`)
const metrics = async (): Promise<Record<string, number>> => {
  const r = (await send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> }
  return Object.fromEntries(r.metrics.map((m) => [m.name, m.value]))
}

interface Gesture {
  name: string
  frames: { p50: number; p95: number; max: number; over33: number; n: number }
  scriptMs: number
  layoutMs: number
  styleMs: number
}

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0
}
const r1 = (n: number): number => Math.round(n * 10) / 10

async function measure(name: string, run: () => Promise<void>): Promise<Gesture> {
  const m0 = await metrics()
  await startFrames()
  await run()
  await sleep(300)
  const f = await stopFrames()
  const m1 = await metrics()
  const d = (k: string): number => r1(((m1[k] ?? 0) - (m0[k] ?? 0)) * 1000)
  return {
    name,
    frames: { p50: r1(pct(f, 50)), p95: r1(pct(f, 95)), max: r1(Math.max(0, ...f)), over33: f.filter((x) => x > 33.4).length, n: f.length },
    scriptMs: d('ScriptDuration'),
    layoutMs: d('LayoutDuration'),
    styleMs: d('RecalcStyleDuration')
  }
}

const mouse = (type: string, x: number, y: number, extra: Record<string, unknown> = {}): Promise<unknown> =>
  send('Input.dispatchMouseEvent', { type, x, y, ...extra })
const size = await evaluate<{ w: number; h: number }>('({ w: innerWidth, h: innerHeight })')
const cx = Math.round(size.w / 2)
const cy = Math.round(size.h / 2)

async function gestures(): Promise<Gesture[]> {
  const out: Gesture[] = []
  out.push(
    await measure('pan (wheel, 60 steps)', async () => {
      for (let i = 0; i < 60; i++) {
        await mouse('mouseWheel', cx, cy, { deltaX: i < 30 ? 18 : -18, deltaY: i % 2 ? 12 : -12 })
        await sleep(16)
      }
    })
  )
  out.push(
    await measure('zoom (ctrl+wheel, 40 steps)', async () => {
      for (let i = 0; i < 40; i++) {
        await mouse('mouseWheel', cx, cy, { deltaY: i < 20 ? -40 : 40, modifiers: 2 })
        await sleep(16)
      }
    })
  )
  const card = await evaluate<{ x: number; y: number } | null>(
    `(() => { const c = [...document.querySelectorAll('.cv-card')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.top > 80 && r.left > 40 && r.bottom < innerHeight - 100 }); if (!c) return null; const r = c.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 30) } })()`
  )
  if (card) {
    out.push(
      await measure('drag a card (60 moves)', async () => {
        await mouse('mousePressed', card.x, card.y, { button: 'left', clickCount: 1 })
        for (let i = 1; i <= 60; i++) {
          await mouse('mouseMoved', card.x + i * 4, card.y + Math.round(Math.sin(i / 6) * 40), { button: 'left', buttons: 1 })
          await sleep(16)
        }
        for (let i = 60; i >= 0; i -= 4) {
          await mouse('mouseMoved', card.x + i * 4, card.y, { button: 'left', buttons: 1 })
          await sleep(16)
        }
        await mouse('mouseReleased', card.x, card.y, { button: 'left', clickCount: 1 })
      })
    )
    out.push(
      await measure('open and close a preview', async () => {
        await mouse('mousePressed', card.x, card.y, { button: 'left', clickCount: 2 })
        await mouse('mouseReleased', card.x, card.y, { button: 'left', clickCount: 2 })
        await sleep(1200)
        for (const type of ['keyDown', 'keyUp'] as const)
          await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await sleep(900)
      })
    )
  }
  return out
}

const results: Array<{ throttle: number; cards: number; gestures: Gesture[] }> = []
for (const rate of THROTTLES) {
  await send('Emulation.setCPUThrottlingRate', { rate })
  results.push({ throttle: rate, cards, gestures: await gestures() })
}
await send('Emulation.setCPUThrottlingRate', { rate: 1 })

if (asJson) console.log(JSON.stringify(results, null, 2))
else
  for (const r of results) {
    console.log(`\n${r.cards} cards in the DOM, CPU x${r.throttle}`)
    console.log('gesture | frames p50/p95/max ms | >33ms | script ms | layout ms | style ms')
    for (const g of r.gestures)
      console.log(
        `${g.name} | ${g.frames.p50}/${g.frames.p95}/${g.frames.max} | ${g.frames.over33}/${g.frames.n} | ${g.scriptMs} | ${g.layoutMs} | ${g.styleMs}`
      )
  }
process.exit(0)
