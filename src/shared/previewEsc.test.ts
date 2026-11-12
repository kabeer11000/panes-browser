import { describe, expect, test } from 'bun:test'
import { ESC_PREFIX, ESC_SCRIPT, isPreviewEsc } from './previewEsc'

/** Runs the page script against a tiny fake page; returns what it reported for one Esc. */
async function press(o: {
  prevented?: boolean
  dialog?: boolean
  fullscreen?: boolean
}): Promise<string[]> {
  const said: string[] = []
  const listeners: Array<(e: unknown) => void> = []
  const win: Record<string | symbol, unknown> = {
    addEventListener: (_t: string, f: (e: unknown) => void) => listeners.push(f)
  }
  const doc = {
    fullscreenElement: o.fullscreen ? {} : null,
    querySelector: () => (o.dialog ? {} : null)
  }
  const con = { debug: (m: string) => said.push(m) }
  new Function('window', 'document', 'console', ESC_SCRIPT)(win, doc, con)
  const e = { key: 'Escape', isComposing: false, repeat: false, defaultPrevented: false }
  for (const f of listeners) f(e)
  if (o.prevented) e.defaultPrevented = true // the page's own listener, running after ours, claimed it
  await new Promise((r) => setTimeout(r, 5))
  return said
}

describe('preview Esc', () => {
  test('an Esc the page left alone is reported', async () => {
    expect(await press({})).toEqual([ESC_PREFIX])
  })
  test('one the page claimed, even after our listener ran, is not', async () => {
    expect(await press({ prevented: true })).toEqual([])
  })
  test('nor one that closes a dialog or leaves fullscreen', async () => {
    expect(await press({ dialog: true })).toEqual([])
    expect(await press({ fullscreen: true })).toEqual([])
  })
  test('only the exact report counts', () => {
    expect(isPreviewEsc(ESC_PREFIX)).toBe(true)
    expect(isPreviewEsc(ESC_PREFIX + 'x')).toBe(false)
  })
})
