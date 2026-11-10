import type { WebContents } from 'electron'
import {
  formatSnapshot,
  MEDIA_SCRIPT,
  SCROLL_SCRIPT,
  SCROLL_TO_SCRIPT,
  SELECT_ALL_SCRIPT,
  SELECT_OPTION_SCRIPT,
  SNAPSHOT_MAX,
  SNAPSHOT_SCRIPT,
  TARGET_SCRIPT,
  type AutoKey,
  type MediaAction,
  type Snapshot,
  type Target
} from '@shared/ai/automation'

/**
 * Driving a tab for the chat: real input events (so sites built on any framework see a person's click and typing),
 * aimed by the fixed scripts in shared/ai/automation. Every step waits for the page to settle and returns what the
 * page looks like after it, so the model can check its work.
 */

const SCRIPT_MS = 4000
const LOAD_MS = 12_000
const SETTLE_MS = 450

const timeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))])

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function exec<T>(wc: WebContents, script: string): Promise<T | null> {
  if (wc.isDestroyed()) return null
  try {
    return (await timeout(wc.executeJavaScript(script, true) as Promise<T>, SCRIPT_MS)) ?? null
  } catch {
    return null
  }
}

/** Wait for what an action set off: a navigation if one starts soon, else a moment for the page to redraw. */
async function settle(wc: WebContents, act: () => void | Promise<void>): Promise<void> {
  let started = false
  const onStart = (_e: unknown, _url: string, _inPlace: boolean, isMain: boolean): void => {
    if (isMain) started = true
  }
  wc.on('did-start-navigation', onStart)
  try {
    await act()
    await sleep(350)
    if (started || wc.isLoading()) {
      await timeout(
        new Promise<void>((r) => {
          if (!wc.isLoading()) return r()
          wc.once('did-stop-loading', () => r())
        }),
        LOAD_MS
      )
    }
    await sleep(SETTLE_MS)
  } finally {
    if (!wc.isDestroyed()) wc.off('did-start-navigation', onStart)
  }
}

/** The page as numbered controls plus visible text, formatted for the model. */
export async function look(wc: WebContents, textCap: number): Promise<string> {
  const s = await exec<Snapshot>(wc, SNAPSHOT_SCRIPT(SNAPSHOT_MAX))
  if (!s || !Array.isArray(s.items))
    return 'Error: this page could not be read (it may still be loading, or be a PDF or a browser page). Try again, or use read_tab.'
  return formatSnapshot(s, textCap)
}

export interface Aim extends Target {
  x: number
  y: number
  password: boolean
  editable: boolean
  select: boolean
}

/** Find a numbered control (scrolling it into view and ringing it), or null when the number is stale. */
export async function aim(wc: WebContents, ref: number): Promise<Aim | null> {
  const a = await exec<Aim>(wc, TARGET_SCRIPT(ref))
  if (!a || typeof a.x !== 'number') return null
  await sleep(120) // the scroll lands before the click
  return a
}

function point(wc: WebContents, a: { x: number; y: number }): { x: number; y: number } {
  const z = wc.getZoomFactor() || 1
  return { x: Math.round(a.x * z), y: Math.round(a.y * z) }
}

export async function click(wc: WebContents, a: Aim): Promise<void> {
  const p = point(wc, a)
  await settle(wc, () => {
    wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  })
}

const KEY_CODE: Record<AutoKey, string> = {
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End'
}
const KEY_CHAR: Partial<Record<AutoKey, string>> = { Enter: '\r', Space: ' ' }

function sendKey(wc: WebContents, key: AutoKey): void {
  const keyCode = KEY_CODE[key]
  wc.sendInputEvent({ type: 'keyDown', keyCode })
  const ch = KEY_CHAR[key]
  if (ch) wc.sendInputEvent({ type: 'char', keyCode: ch })
  wc.sendInputEvent({ type: 'keyUp', keyCode })
}

export async function press(wc: WebContents, key: AutoKey): Promise<void> {
  await settle(wc, () => sendKey(wc, key))
}

/** Focus the field with a click, select what is in it, and type over it (Enter after, when asked). */
export async function type(
  wc: WebContents,
  ref: number,
  a: Aim,
  text: string,
  submit: boolean
): Promise<void> {
  const p = point(wc, a)
  wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  await sleep(80)
  await exec(wc, SELECT_ALL_SCRIPT(ref))
  if (text) await wc.insertText(text)
  else sendKey(wc, 'Backspace')
  if (submit) await settle(wc, () => sendKey(wc, 'Enter'))
  else await sleep(250)
}

export async function selectOption(
  wc: WebContents,
  ref: number,
  option: string
): Promise<{ ok: boolean; text?: string; options?: string[] } | null> {
  return exec(wc, SELECT_OPTION_SCRIPT(ref, option))
}

export async function scroll(
  wc: WebContents,
  dir: 'up' | 'down' | 'top' | 'bottom'
): Promise<void> {
  await exec(wc, SCROLL_SCRIPT(dir))
  await sleep(300)
}

export async function navigate(wc: WebContents, url: string): Promise<void> {
  await settle(wc, () => {
    void wc.loadURL(url).catch(() => undefined)
  })
}

export async function back(wc: WebContents): Promise<boolean> {
  if (!wc.navigationHistory.canGoBack()) return false
  await settle(wc, () => wc.navigationHistory.goBack())
  return true
}

/** Play, pause, mute, skip or change the speed of the media on a page; null when it has none. */
export async function media(
  wc: WebContents,
  action: MediaAction,
  amount: number
): Promise<{
  paused: boolean
  muted: boolean
  time: number
  duration: number | null
  rate: number
} | null> {
  const r = await exec<{
    ok: boolean
    paused: boolean
    muted: boolean
    time: number
    duration: number | null
    rate: number
  }>(wc, MEDIA_SCRIPT(action, amount))
  return r?.ok ? r : null
}

/** Scroll to a heading, section or words on a page (or its comments); false when nothing matches. */
export async function scrollTo(
  wc: WebContents,
  target: string
): Promise<{ what: string } | { heads: string[] }> {
  const r = await exec<{ ok: boolean; what?: string; heads?: string[] }>(
    wc,
    SCROLL_TO_SCRIPT(target)
  )
  if (!r?.ok) return { heads: r?.heads ?? [] }
  await sleep(500) // lazy parts (comments) load as they come into view
  return { what: r.what ?? target }
}
