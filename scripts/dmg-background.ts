// Renders the Mac disk image's background (build/dmg/background.html) to build/background.png and
// build/background@2x.png. electron-builder finds them by those names and, on the Mac runner, joins the two into one
// HiDPI TIFF. Rerun after changing the HTML:
//
//   bun scripts/dmg-background.ts            (uses Edge or Chrome; set CHROME=<path> to pick another)
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const W = 600
const H = 440
const root = resolve(import.meta.dir, '..')
const page = pathToFileURL(join(root, 'build/dmg/background.html')).href

const candidates = [
  process.env.CHROME,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome'
].filter((p): p is string => !!p)
const browser = candidates.find((p) => existsSync(p))
if (!browser) throw new Error('No Chrome or Edge found; set CHROME to one')

const proc = Bun.spawn(
  [
    browser,
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'dmgbg-'))}`,
    '--hide-scrollbars',
    'about:blank'
  ],
  { stderr: 'pipe', stdout: 'ignore' }
)
let wsUrl = ''
{
  const rd = proc.stderr.getReader()
  let text = ''
  while (!wsUrl) {
    const { value, done } = await rd.read()
    if (done) throw new Error('browser exited: ' + text)
    text += new TextDecoder().decode(value)
    wsUrl = text.match(/DevTools listening on (ws:\/\/\S+)/)?.[1] ?? ''
  }
}
const port = new URL(wsUrl).port
const target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
  (t: { type: string }) => t.type === 'page'
)
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map<number, (v: unknown) => void>()
ws.onmessage = (m) => {
  const d = JSON.parse(String(m.data))
  if (d.id) pending.get(d.id)?.(d.result)
}
const send = (method: string, params: object = {}): Promise<any> =>
  new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })

for (const scale of [1, 2]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: scale,
    mobile: false
  })
  await send('Page.enable')
  await send('Page.navigate', { url: page })
  await send('Runtime.evaluate', {
    expression:
      'document.readyState === "complete" || new Promise(r => addEventListener("load", r, { once: true }))',
    awaitPromise: true
  })
  await send('Runtime.evaluate', {
    expression: 'document.fonts.ready.then(() => document.fonts.size)',
    awaitPromise: true
  })
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: W, height: H, scale: 1 }
  })
  const out = join(root, 'build', scale === 1 ? 'background.png' : 'background@2x.png')
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(out)
}
ws.close()
proc.kill()
process.exit(0)
