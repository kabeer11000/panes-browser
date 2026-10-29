/**
 * Memory and CPU of a running Panes, per process, to spot regressions.
 *
 * Usage (bun has a WebSocket; plain Node 18 does not):
 *
 *   bun scripts/perf-report.ts [port] [--sample <seconds>] [--json]
 *
 * `port` is the remote debugging port Panes was started with (default 9222), for example:
 *
 *   REMOTE_DEBUGGING_PORT=9333 PANES_USERDATA=%TEMP%\panes-perf bun run dev
 *   (or `electron out/main/index.js --remote-debugging-port=9333` on a built copy)
 *
 * It asks Chromium for its process list over the DevTools protocol (SystemInfo.getProcessInfo), reads each
 * process's private memory from the OS (Private Bytes on Windows, RSS elsewhere), and with `--sample` measures
 * each process's CPU over that many seconds. `--json` prints one machine-readable line instead of the table.
 */
import { execFileSync } from 'child_process'

interface ProcessInfo {
  type: string
  id: number
  /** Seconds of CPU since the process started. */
  cpuTime: number
}

const args = process.argv.slice(2)
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 9222)
const sampleIdx = args.indexOf('--sample')
const sampleS = sampleIdx >= 0 ? Number(args[sampleIdx + 1]) || 5 : 0
const asJson = args.includes('--json')

async function cdp<T>(method: string): Promise<T> {
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
    webSocketDebuggerUrl: string
  }
  const ws = new WebSocket(version.webSocketDebuggerUrl)
  return new Promise<T>((resolve, reject) => {
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method }))
    ws.onerror = () => reject(new Error(`cannot reach the debugging port ${port}`))
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id !== 1) return
      ws.close()
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result as T)
    }
  })
}

const processes = async (): Promise<ProcessInfo[]> =>
  (await cdp<{ processInfo: ProcessInfo[] }>('SystemInfo.getProcessInfo')).processInfo

/** Private memory in KB by pid, from the OS. */
function memoryKb(pids: number[]): Map<number, number> {
  const out = new Map<number, number>()
  if (process.platform === 'win32') {
    const ps = `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $($_.PrivateMemorySize64)" }`
    const text = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
    for (const line of text.trim().split(/\r?\n/)) {
      const [pid, bytes] = line.trim().split(/\s+/).map(Number)
      if (pid) out.set(pid, Math.round(bytes / 1024))
    }
  } else {
    const text = execFileSync('ps', ['-o', 'pid=,rss=', '-p', pids.join(',')], { encoding: 'utf8' })
    for (const line of text.trim().split('\n')) {
      const [pid, kb] = line.trim().split(/\s+/).map(Number)
      if (pid) out.set(pid, kb)
    }
  }
  return out
}

async function main(): Promise<void> {
  const before = await processes()
  let cpu = new Map<number, number>()
  if (sampleS > 0) {
    await new Promise((r) => setTimeout(r, sampleS * 1000))
    const after = await processes()
    const was = new Map(before.map((p) => [p.id, p.cpuTime]))
    cpu = new Map(
      after.map((p) => [p.id, ((p.cpuTime - (was.get(p.id) ?? p.cpuTime)) / sampleS) * 100])
    )
  }
  const list = before.filter((p) => p.id > 0)
  const mem = memoryKb(list.map((p) => p.id))
  const rows = list
    .map((p) => ({ type: p.type, pid: p.id, mb: (mem.get(p.id) ?? 0) / 1024, cpu: cpu.get(p.id) }))
    .sort((a, b) => b.mb - a.mb)
  const totalMb = rows.reduce((s, r) => s + r.mb, 0)
  const totalCpu = rows.reduce((s, r) => s + (r.cpu ?? 0), 0)

  if (asJson) {
    console.log(
      JSON.stringify({ processes: rows.length, totalMb, totalCpu: sampleS ? totalCpu : null, rows })
    )
    return
  }
  console.log(
    'type'.padEnd(10) +
      'pid'.padStart(8) +
      'private MB'.padStart(12) +
      (sampleS ? 'CPU %'.padStart(8) : '')
  )
  for (const r of rows) {
    console.log(
      r.type.padEnd(10) +
        String(r.pid).padStart(8) +
        r.mb.toFixed(1).padStart(12) +
        (sampleS ? (r.cpu ?? 0).toFixed(1).padStart(8) : '')
    )
  }
  console.log(
    `${rows.length} processes, ${totalMb.toFixed(1)} MB private` +
      (sampleS ? `, ${totalCpu.toFixed(1)}% CPU over ${sampleS}s` : '')
  )
}

main().catch((err) => {
  console.error(String(err?.message ?? err))
  process.exit(1)
})
