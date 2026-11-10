/**
 * Local model benchmark: speed and agency for each model and backend, with the prompts Panes itself builds.
 *
 *   bun scripts/ai-bench.ts --dir E:/ai-bench [--threads 4] [--backends cpu,vulkan] [--models a,b] [--skip-agency]
 *
 * <dir>/runtime/cpu|vulkan/llama-server.exe are the llama.cpp builds Panes downloads (LLAMA_TAG), <dir>/models/*.gguf
 * the models to try (--models filters by file name). --threads 4 stands in for a 4-core laptop (i5 10th gen); leave
 * it out on the laptop itself. Results go to <dir>/results-<time>.json and a table on stdout.
 *
 * Speed: a long article (Wikipedia) attached as the current page:
 *   cold     first question, nothing cached: what the person waits for today
 *   follow   a second question about the same page: only the new turn should be read
 *   primed   another page read ahead (as the panel does while typing), then the question
 * Agency: requests from real chats (tabs, scrolling, media, sites, page questions), scored on the first reply.
 */

import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { join } from 'path'
import {
  chatSystem,
  leakedCall,
  localBudget,
  LOCAL_PAGE_CAP,
  tabsBlock,
  toolsFor
} from '../src/shared/ai/chatTools'
import { assemblePrompt, promptMessages, type PromptPage } from '../src/shared/ai/chatPrompt'
import { quickCommand } from '../src/shared/ai/commands'
import { quickAction } from '../src/shared/ai/sites'
import type { ToolInput } from '../src/shared/ai/chatTools'
import { CONTEXT_TOKENS, serverArgs } from '../src/shared/ai/server'

const arg = (name: string, def = ''): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? (process.argv[i + 1] ?? '') : def
}
const DIR = arg('dir', 'E:/ai-bench')
// a CPU mask in hex (FF: 4 cores and their hyperthreads on most PCs), standing in for a smaller CPU
const AFFINITY = arg('affinity')
const CPUS = AFFINITY ? [...parseInt(AFFINITY, 16).toString(2)].filter((b) => b === '1').length : 0
const REPEAT = Number(arg('repeat', '1'))
const SPEED = !process.argv.includes('--skip-speed')
const BACKENDS = arg('backends', 'cpu,vulkan').split(',').filter(Boolean)
const ONLY = arg('models').split(',').filter(Boolean)
const AGENCY = !process.argv.includes('--skip-agency')
const KEY = 'bench'
const TODAY = new Date().toISOString().slice(0, 10)

// ---- fixtures ----

async function article(title: string): Promise<string> {
  const file = join(DIR, `${title}.txt`)
  if (existsSync(file)) return Bun.file(file).text()
  const res = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&titles=${encodeURIComponent(title)}`,
    { headers: { 'user-agent': 'panes-ai-bench/1.0' } }
  )
  const body = (await res.json()) as { query: { pages: Record<string, { extract: string }> } }
  const text = Object.values(body.query.pages)[0].extract
  writeFileSync(file, text)
  return text
}

const TABS = [
  { id: 4, title: 'Settings', url: 'panes://settings', active: true },
  {
    id: 7,
    title: 'lofi hip hop radio - beats to relax/study to - YouTube',
    url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    active: false
  },
  {
    id: 9,
    title: 'Apollo 11 - Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Apollo_11',
    active: false
  },
  { id: 12, title: 'Pricing - Vercel', url: 'https://vercel.com/pricing', active: false }
]

// ---- llama-server ----

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })

interface Server {
  proc: ChildProcess
  port: number
  loadMs: number
  log: () => string
}

async function start(backend: string, model: string): Promise<Server> {
  const bin = join(DIR, 'runtime', backend, 'llama-server.exe')
  const port = await freePort()
  const cpus = CPUS || (await import('os')).availableParallelism()
  const args = serverArgs({
    role: 'chat',
    modelPath: model,
    port,
    apiKey: KEY,
    gpu: backend !== 'cpu',
    cpus
  })
  if (CPUS) args.push('-t', String(Math.max(1, CPUS / 2)))
  const t0 = Date.now()
  const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let tail = ''
  if (AFFINITY)
    Bun.spawnSync([
      'powershell',
      '-NoProfile',
      '-c',
      `(Get-Process -Id ${proc.pid}).ProcessorAffinity = 0x${AFFINITY}`
    ])
  proc.stderr?.on('data', (c: Buffer) => (tail = (tail + c.toString()).slice(-4000)))
  for (let i = 0; i < 600 && proc.exitCode === null; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok)
        return { proc, port, loadMs: Date.now() - t0, log: () => tail }
    } catch {
      // not up yet
    }
    await Bun.sleep(250)
  }
  proc.kill()
  throw new Error(`server did not start: ${tail.split('\n').slice(-5).join(' | ')}`)
}

function memMB(pid: number): number {
  const out = Bun.spawnSync([
    'tasklist',
    '/FI',
    `PID eq ${pid}`,
    '/FO',
    'CSV',
    '/NH'
  ]).stdout.toString()
  const m = /"([\d,.\s]+) K"/.exec(out)
  return m ? Math.round(Number(m[1].replace(/[^\d]/g, '')) / 1024) : 0
}

interface Reply {
  text: string
  tool: string | null
  args: Record<string, unknown>
  promptN: number
  promptMs: number
  genN: number
  genMs: number
  wallMs: number
}

const TOOL_NAMES = toolsFor(true, 'panel').map((t) => t.name)
const TOOLS = toolsFor(true, 'panel').map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.schema }
}))

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

async function ask(s: Server, messages: Msg[], maxTokens = 300): Promise<Reply> {
  const t0 = Date.now()
  const res = await fetch(`http://127.0.0.1:${s.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ messages, tools: TOOLS, temperature: 0.4, max_tokens: maxTokens })
  })
  const body = (await res.json()) as {
    choices?: Array<{
      message: {
        content?: string
        tool_calls?: Array<{ function: { name: string; arguments: string } }>
      }
    }>
    timings?: { prompt_n: number; prompt_ms: number; predicted_n: number; predicted_ms: number }
    error?: { message: string }
  }
  if (!body.choices) throw new Error(body.error?.message ?? `HTTP ${res.status}`)
  const m = body.choices[0].message
  const call = m.tool_calls?.[0]?.function
  let args: Record<string, unknown> = {}
  try {
    args = call ? JSON.parse(call.arguments) : {}
  } catch {
    args = {}
  }
  const t = body.timings
  return {
    text: (m.content ?? '').trim(),
    tool: call?.name ?? null,
    args,
    promptN: t?.prompt_n ?? 0,
    promptMs: t?.prompt_ms ?? 0,
    genN: t?.predicted_n ?? 0,
    genMs: t?.predicted_ms ?? 0,
    wallMs: Date.now() - t0
  }
}

/** The messages Panes sends for a question (local model, panel). */
function turn(question: string, pages: PromptPage[], history: Msg[] = []): Msg[] {
  const fit = localBudget(CONTEXT_TOKENS, question.length)
  const p = assemblePrompt({
    system: chatSystem({ weak: true, mode: 'panel', today: TODAY }),
    docs: '',
    pages,
    pageCap: Math.min(fit.content, LOCAL_PAGE_CAP), // as ChatService.prepare
    tabs: tabsBlock(TABS),
    typed: question
  })
  return [{ role: 'system', content: p.system }, ...(promptMessages<Msg>(p, history) as Msg[])]
}

/** A call written out as text counts when the app would carry it out (leakedCall), as it does for the person. */
function effective(r: Reply): Reply & { leaked: boolean } {
  if (r.tool || !r.text) return { ...r, leaked: false }
  const call = leakedCall(r.text, TOOL_NAMES, 4)
  if (!call) return { ...r, leaked: false }
  const { name, ...args } = call
  return { ...r, tool: name, args, text: '', leaked: true }
}

// ---- agency cases ----

interface Case {
  ask: string
  page?: boolean
  ok: (r: Reply) => boolean
}

const tabIs = (r: Reply, id: number, current = 4): boolean =>
  (r.args.tabId ?? current) === id || r.args.tabId === String(id)
const CASES: Case[] = [
  { ask: 'hi', ok: (r) => !r.tool && r.text.length > 0 },
  {
    ask: 'what are my tabs',
    ok: (r) => r.tool === 'list_tabs' || (/youtube|lofi/i.test(r.text) && /settings/i.test(r.text))
  },
  {
    ask: 'what tab do i currently have opend',
    ok: (r) => (!r.tool && /settings/i.test(r.text)) || r.tool === 'list_tabs'
  },
  {
    ask: 'can you scroll to ai settings on my current tab',
    ok: (r) => r.tool === 'scroll_to' && /\bai\b/i.test(String(r.args.target)) && tabIs(r, 4)
  },
  {
    ask: 'read my current tab and tell me what it says',
    ok: (r) => r.tool === 'read_tab' && tabIs(r, 4)
  },
  {
    ask: 'pause the youtube video',
    ok: (r) => r.tool === 'media_control' && r.args.action === 'pause' && tabIs(r, 7)
  },
  { ask: 'go to my youtube tab', ok: (r) => r.tool === 'switch_to_tab' && tabIs(r, 7) },
  {
    ask: 'play piano covers on youtube',
    ok: (r) =>
      r.tool === 'search_on_site' &&
      /youtube/i.test(String(r.args.site)) &&
      /piano/i.test(String(r.args.query))
  },
  {
    ask: 'open github.com',
    ok: (r) => r.tool === 'open_tab' && /github\.com/i.test(String(r.args.url))
  },
  { ask: 'scroll down', ok: (r) => r.tool === 'scroll_page' && r.args.direction === 'down' },
  {
    ask: 'find the word pricing on this page',
    ok: (r) => r.tool === 'find_in_page' && /pricing/i.test(String(r.args.text))
  },
  { ask: 'what did i download recently?', ok: (r) => r.tool === 'list_downloads' },
  {
    ask: 'how much lunar material did they bring back?',
    page: true,
    ok: (r) => !r.tool && /21\.5|47\.5/.test(r.text)
  },
  {
    ask: 'who stayed in lunar orbit while the others walked on the moon?',
    page: true,
    ok: (r) => !r.tool && /collins/i.test(r.text)
  },
  {
    ask: 'summarize this page in 3 bullet points',
    page: true,
    ok: (r) => !r.tool && r.text.length > 120 && /armstrong|aldrin|moon/i.test(r.text)
  }
]

// ---- run ----

interface Result {
  model: string
  backend: string
  threads: string
  loadS: number
  memMB: number
  cold: { promptN: number; promptTps: number; firstWordS: number; genTps: number; right: boolean }
  follow: { promptN: number; firstWordS: number }
  primed: { primeS: number; promptN: number; firstWordS: number }
  agency: { passed: number; total: number; failed: Array<{ ask: string; got: string }> }
  headS: number
  error?: string
}

const r1 = (n: number): number => Math.round(n * 10) / 10
const NONE: Reply = {
  text: '',
  tool: null,
  args: {},
  promptN: 0,
  promptMs: 0,
  genN: 0,
  genMs: 1,
  wallMs: 0
}

/** quickAction's site search or opening, as the call it stands for. */
function quickActionCall(ask: string): ToolInput | null {
  const q = quickAction(ask)
  if (!q) return null
  return q.kind === 'search'
    ? { name: 'search_on_site', site: q.site, query: q.query }
    : { name: 'open_tab', url: q.url }
}

async function bench(
  backend: string,
  model: string,
  apollo: PromptPage,
  everest: PromptPage
): Promise<Result> {
  const name = model.split(/[\\/]/).pop() ?? model
  console.log(`\n== ${name} on ${backend}${AFFINITY ? ` (affinity ${AFFINITY})` : ''}`)
  const s = await start(backend, model)
  try {
    const none: Reply = {
      text: '',
      tool: null,
      args: {},
      promptN: 0,
      promptMs: 0,
      genN: 0,
      genMs: 1,
      wallMs: 0
    }
    let cold = none
    let follow = none
    let primed = none
    let primeS = 0
    let headS = 0
    if (SPEED) {
      // the panel opens: instructions and tools are read ahead (the same for every turn)
      const h0 = Date.now()
      await ask(s, turn('', []), 1)
      headS = (Date.now() - h0) / 1000
      console.log(`panel open: instructions + tools read in ${r1(headS)} s`)
      // a page attached and asked about at once: its opening is read now
      const q1 = 'How much lunar material did the mission bring back to Earth?'
      cold = await ask(s, turn(q1, [apollo]))
      console.log(
        `page asked at once: read ${cold.promptN} tok in ${r1(cold.promptMs / 1000)} s (${r1(cold.promptN / (cold.promptMs / 1000))} tok/s), ${r1(cold.genN / (cold.genMs / 1000))} tok/s out`
      )
      const history: Msg[] = [
        { role: 'user', content: q1 },
        { role: 'assistant', content: cold.text || 'Done.' }
      ]
      follow = await ask(s, turn('Who was the command module pilot?', [apollo], history))
      console.log(`follow-up: read ${follow.promptN} tok in ${r1(follow.promptMs / 1000)} s`)
      // another page read ahead while the question is typed, then asked
      const p0 = Date.now()
      await ask(s, turn('', [everest]), 1)
      primeS = (Date.now() - p0) / 1000
      primed = await ask(s, turn('How tall is the mountain?', [everest]))
      console.log(
        `primed page: read ahead in ${r1(primeS)} s, then ${primed.promptN} tok in ${r1(primed.promptMs / 1000)} s`
      )
    }

    const failed: Result['agency']['failed'] = []
    let passed = 0
    let leaks = 0
    if (AGENCY)
      for (let k = 0; k < REPEAT; k++)
        for (const c of CASES) {
          // as ChatService.send: plain commands are carried out without the model
          const direct = c.page ? null : (quickCommand(c.ask, TABS)?.call ?? quickActionCall(c.ask))
          const r = direct
            ? {
                ...NONE,
                tool: direct.name,
                args: (({ name: _n, ...a }) => a)(direct),
                leaked: false,
                direct: true
              }
            : { ...effective(await ask(s, turn(c.ask, c.page ? [apollo] : []))), direct: false }
          const ok = c.ok(r)
          if (ok) passed++
          if (r.leaked) leaks++
          const got = r.tool
            ? `${r.direct ? '(no model) ' : r.leaked ? '(written out) ' : ''}${r.tool} ${JSON.stringify(r.args)}`
            : JSON.stringify(r.text.slice(0, 120))
          if (!ok) failed.push({ ask: c.ask, got })
          console.log(`${ok ? 'PASS' : 'FAIL'} ${c.ask} -> ${got}`)
        }
    if (AGENCY)
      console.log(`agency ${passed}/${CASES.length * REPEAT}, ${leaks} written out and recovered`)
    return {
      model: name,
      backend,
      threads: AFFINITY || 'all',
      loadS: r1(s.loadMs / 1000),
      memMB: memMB(s.proc.pid ?? 0),
      cold: {
        promptN: cold.promptN,
        promptTps: r1(cold.promptN / (cold.promptMs / 1000)),
        firstWordS: r1(cold.promptMs / 1000),
        genTps: r1(cold.genN / (cold.genMs / 1000)),
        right: /21\.5|47\.5/.test(cold.text)
      },
      follow: { promptN: follow.promptN, firstWordS: r1(follow.promptMs / 1000) },
      primed: {
        primeS: r1(primeS),
        promptN: primed.promptN,
        firstWordS: r1(primed.promptMs / 1000)
      },
      agency: { passed, total: AGENCY ? CASES.length * REPEAT : 0, failed },
      headS: r1(headS)
    }
  } finally {
    s.proc.kill()
    await Bun.sleep(500)
  }
}

const page = (tabId: number, title: string, url: string, text: string): PromptPage => ({
  tabId,
  title,
  url,
  text
})
const apollo = page(
  9,
  'Apollo 11 - Wikipedia',
  'https://en.wikipedia.org/wiki/Apollo_11',
  await article('Apollo 11')
)
const everest = page(
  13,
  'Mount Everest - Wikipedia',
  'https://en.wikipedia.org/wiki/Mount_Everest',
  await article('Mount Everest')
)
mkdirSync(DIR, { recursive: true })
const models = readdirSync(join(DIR, 'models'))
  .filter((f) => f.endsWith('.gguf') && (ONLY.length === 0 || ONLY.some((o) => f.includes(o))))
  .map((f) => join(DIR, 'models', f))
const results: Result[] = []
for (const m of models)
  for (const b of BACKENDS) {
    try {
      results.push(await bench(b, m, apollo, everest))
    } catch (err) {
      console.log(`ERROR ${m} ${b}: ${err instanceof Error ? err.message : err}`)
    }
  }
const out = join(DIR, `results-${Date.now()}.json`)
writeFileSync(out, JSON.stringify(results, null, 2))
console.log(
  `\nmodel | backend | load s | RAM MB | cold: tok, read tok/s, first word s | gen tok/s | follow-up: tok, s | primed: prime s, tok, s | agency`
)
for (const r of results)
  console.log(
    `${r.model} | ${r.backend} | ${r.loadS} | ${r.memMB} | ${r.cold.promptN}, ${r.cold.promptTps}, ${r.cold.firstWordS}${r.cold.right ? '' : ' (wrong)'} | ${r.cold.genTps} | ${r.follow.promptN}, ${r.follow.firstWordS} | ${r.primed.primeS}, ${r.primed.promptN}, ${r.primed.firstWordS} | ${r.agency.passed}/${r.agency.total}`
  )
console.log(`\n${out}`)
process.exit(0)
