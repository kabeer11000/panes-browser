/**
 * Drive a test Panes over the DevTools protocol, without the OS cursor, keyboard or focus.
 *
 * Start one (its own profile, window parked beyond every screen, never focused):
 *
 *   PANES_OFFSCREEN=1 PANES_USERDATA=E:/tmp/panes-test REMOTE_DEBUGGING_PORT=9350 bun run dev
 *
 * Then, from another shell:
 *
 *   bun scripts/drive.ts [--port 9350] [--target <url part>] <command> [args]
 *
 *   targets                 list pages (the interface is the one whose url is the renderer's index)
 *   shot <file.png>         screenshot of the target (one page only)
 *   winshot <file.png>      screenshot of the whole window, pages included (scripts/winshot.ps1)
 *   click <x> <y> [right]   mouse click at CSS pixels of the target
 *   move <x> <y>            mouse move
 *   drag <x1> <y1> <x2> <y2> [steps]
 *   wheel <x> <y> <dx> <dy> [ctrl]
 *   type <text>             insert text where the focus is
 *   key <combo>             e.g. ctrl+t, Escape, ctrl+shift+e, Enter
 *   eval <js>               evaluate in the target, prints the JSON result
 *   main <js>               evaluate in the main process (needs `-- --inspect=<port+1>` on the dev command);
 *                           `panesTest` holds { win, tabs, spaces, settings }, e.g.
 *                           main "panesTest.win.webContents.send('ui:command', 'toggle-canvas')"
 *
 * The default target is the Panes interface. `--target youtube` picks the first page whose url contains it.
 * Mouse events sent to the interface page land on the interface, not on a tab page under it: send those to the tab's
 * own target.
 */

const argv = process.argv.slice(2)
const opt = (name: string, fallback: string): string => {
  const i = argv.indexOf(name)
  if (i < 0) return fallback
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}
const port = Number(opt('--port', process.env['PANES_PORT'] ?? '9350'))
const targetPart = opt('--target', '')
const [cmd, ...rest] = argv

interface Target {
  id: string
  type: string
  url: string
  title: string
  webSocketDebuggerUrl: string
}

async function targets(): Promise<Target[]> {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  return ((await res.json()) as Target[]).filter((t) => t.type === 'page')
}

function isUi(t: Target): boolean {
  return /\/index\.html|^http:\/\/localhost:\d+\/(\?|$)/.test(t.url) && t.title === 'Panes'
}

async function pick(): Promise<Target> {
  const all = await targets()
  const t = targetPart ? all.find((x) => x.url.includes(targetPart)) : all.find(isUi)
  if (!t) throw new Error(`no target ${targetPart || '(Panes interface)'} on port ${port}`)
  return t
}

class Session {
  private next = 1
  private waiting = new Map<
    number,
    (v: { result?: unknown; error?: { message: string } }) => void
  >()
  private constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data))
      const done = this.waiting.get(msg.id)
      if (done) {
        this.waiting.delete(msg.id)
        done(msg)
      }
    }
  }
  static open(url: string): Promise<Session> {
    const ws = new WebSocket(url)
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve(new Session(ws))
      ws.onerror = () => reject(new Error('cannot open the target'))
    })
  }
  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.next++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) =>
      this.waiting.set(id, (m) =>
        m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result as T)
      )
    )
  }
}

const KEYS: Record<string, { key: string; code: string; keyCode: number }> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  f11: { key: 'F11', code: 'F11', keyCode: 122 },
  f12: { key: 'F12', code: 'F12', keyCode: 123 },
  '\\': { key: '\\', code: 'Backslash', keyCode: 220 }
}

function keyOf(name: string): { key: string; code: string; keyCode: number } {
  const known = KEYS[name.toLowerCase()]
  if (known) return known
  if (/^[a-z]$/i.test(name)) {
    const up = name.toUpperCase()
    return { key: name.toLowerCase(), code: `Key${up}`, keyCode: up.charCodeAt(0) }
  }
  if (/^[0-9]$/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0) }
  throw new Error(`unknown key ${name}`)
}

async function main(): Promise<void> {
  if (!cmd || cmd === 'help') {
    console.log(
      'commands: targets | shot <file> | click x y [right] | move x y | drag x1 y1 x2 y2 [steps] | wheel x y dx dy [ctrl] | type <text> | key <combo> | eval <js>'
    )
    return
  }
  if (cmd === 'targets') {
    for (const t of await targets())
      console.log(
        `${isUi(t) ? '*' : ' '} ${t.title.slice(0, 40).padEnd(40)} ${t.url.slice(0, 100)}`
      )
    return
  }
  if (cmd === 'winshot') {
    const out = rest[0] ?? 'winshot.png'
    // the Electron main process of this port: its command line has the port and no --type=
    const pid = Bun.spawnSync([
      'powershell',
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -match 'remote-debugging-port=${port}' -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1).ProcessId`
    ])
      .stdout.toString()
      .trim()
    if (!pid) throw new Error(`no Panes main process on port ${port}`)
    const r = Bun.spawnSync([
      'powershell',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      `${import.meta.dir}/winshot.ps1`,
      '-ProcessId',
      pid,
      '-Out',
      out
    ])
    if (r.exitCode !== 0) throw new Error(r.stderr.toString())
    console.log(out)
    return
  }
  if (cmd === 'main') {
    const list = (await (await fetch(`http://127.0.0.1:${port + 1}/json/list`)).json()) as Target[]
    const m = await Session.open(list[0].webSocketDebuggerUrl)
    const r = await m.send<{
      result: { value?: unknown }
      exceptionDetails?: { text: string; exception?: { description?: string } }
    }>('Runtime.evaluate', {
      expression: rest.join(' '),
      returnByValue: true,
      awaitPromise: true,
      includeCommandLineAPI: true
    })
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    console.log(JSON.stringify(r.result.value, null, 1))
    return
  }
  const s = await Session.open((await pick()).webSocketDebuggerUrl)
  const mouse = (
    type: string,
    x: number,
    y: number,
    extra: Record<string, unknown> = {}
  ): Promise<unknown> => s.send('Input.dispatchMouseEvent', { type, x, y, ...extra })
  const n = (i: number): number => Number(rest[i])

  switch (cmd) {
    case 'shot': {
      const { data } = await s.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
      await Bun.write(rest[0] ?? 'shot.png', Buffer.from(data, 'base64'))
      console.log(rest[0] ?? 'shot.png')
      break
    }
    case 'move':
      await mouse('mouseMoved', n(0), n(1))
      break
    case 'click': {
      const button = rest[2] === 'right' ? 'right' : 'left'
      await mouse('mouseMoved', n(0), n(1))
      await mouse('mousePressed', n(0), n(1), { button, clickCount: 1 })
      await mouse('mouseReleased', n(0), n(1), { button, clickCount: 1 })
      break
    }
    case 'drag': {
      const [x1, y1, x2, y2] = [n(0), n(1), n(2), n(3)]
      const steps = Number(rest[4] ?? 12)
      await mouse('mouseMoved', x1, y1)
      await mouse('mousePressed', x1, y1, { button: 'left', clickCount: 1, buttons: 1 })
      for (let i = 1; i <= steps; i++) {
        await mouse('mouseMoved', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps, {
          buttons: 1
        })
        await Bun.sleep(16)
      }
      await mouse('mouseReleased', x2, y2, { button: 'left', clickCount: 1 })
      break
    }
    case 'wheel':
      await mouse('mouseWheel', n(0), n(1), {
        deltaX: n(2),
        deltaY: n(3),
        modifiers: rest[4] === 'ctrl' ? 2 : 0
      })
      break
    case 'type':
      await s.send('Input.insertText', { text: rest.join(' ') })
      break
    case 'key': {
      const parts = rest[0].split('+')
      const name = parts.pop() as string
      const mods = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const
      const modifiers = parts.reduce(
        (m, p) => m | (mods[p.toLowerCase() as keyof typeof mods] ?? 0),
        0
      )
      const k = keyOf(name)
      const base = { modifiers, key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode }
      const text =
        !modifiers || modifiers === 8
          ? k.key.length === 1
            ? k.key
            : k.key === 'Enter'
              ? '\r'
              : undefined
          : undefined
      await s.send('Input.dispatchKeyEvent', {
        type: text ? 'keyDown' : 'rawKeyDown',
        text,
        ...base
      })
      await s.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
      break
    }
    case 'eval': {
      const r = await s.send<{
        result: { value?: unknown }
        exceptionDetails?: { text: string; exception?: { description?: string } }
      }>('Runtime.evaluate', {
        expression: rest.join(' '),
        returnByValue: true,
        awaitPromise: true
      })
      if (r.exceptionDetails)
        throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      console.log(JSON.stringify(r.result.value, null, 1))
      break
    }
    default:
      throw new Error(`unknown command ${cmd}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e instanceof Error ? e.message : e))
    process.exit(1)
  })
