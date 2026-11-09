import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { jsonSchema, tool, type ToolSet } from 'ai'
import type { JSONSchema7 } from 'json-schema'
import { boardToolsFor, checkBoardCall } from '@shared/ai/canvasTools'
import type { ToolName } from '@shared/ai/chatTools'
import type { ToolPart } from '@shared/ai/chatConv'

/**
 * The canvas assistant's tools. The board lives in the renderer (it is the source of truth and every change there is
 * one undoable step), so a call is checked here and then handed to the board over IPC; the board answers with what
 * happened, and that text goes back to the model. This file never touches a tab: the browser tools are the chat
 * backend's own.
 */
export const canvasBridge: {
  win: BrowserWindow | null
  /** The window is a normal one: nothing is done for a private or Tor window. */
  allowed: () => boolean
} = { win: null, allowed: () => false }

interface Waiting {
  resolve: (text: string) => void
}
const waiting = new Map<string, Waiting>()
let counter = 0
let wired = false

function wire(): void {
  if (wired) return
  wired = true
  ipcMain.on('canvas:tool-result', (e, id: unknown, text: unknown) => {
    if (e.sender !== canvasBridge.win?.webContents || typeof id !== 'string') return
    const w = waiting.get(id)
    if (!w) return
    waiting.delete(id)
    w.resolve(typeof text === 'string' ? text.slice(0, 8000) : '')
  })
}

function callBoard(name: string, args: unknown, signal: AbortSignal): Promise<string> {
  wire()
  const win = canvasBridge.win
  if (!win || win.isDestroyed() || !canvasBridge.allowed()) {
    return Promise.resolve('Error: the board is not available.')
  }
  const id = `bt${++counter}`
  return new Promise<string>((resolve) => {
    const done = (text: string): void => {
      waiting.delete(id)
      signal.removeEventListener('abort', onAbort)
      clearTimeout(timer)
      resolve(text)
    }
    const onAbort = (): void => done('Stopped.')
    const timer = setTimeout(() => done('Error: the board did not answer.'), 180_000)
    signal.addEventListener('abort', onAbort)
    waiting.set(id, { resolve: done })
    win.webContents.send('canvas:tool', id, name, args)
  })
}

/**
 * Put a web page on the board as a card, for "Add to canvas" outside the board (reader mode). The board may still be
 * opening or loading: until its listener answers, the call is retried. A call the board did receive answers within
 * milliseconds, so only an unheard one is ever retried and the card is never added twice.
 */
export async function addCardToBoard(url: string): Promise<boolean> {
  return untilBoard('add_card', { url, near: null })
}

/**
 * Put a finished download on the board (the download shelf's "Show in canvas"). `file` must be a download's own path:
 * the board reads it through main, which only serves finished downloads. Not a model tool.
 */
export async function addFileToBoard(file: string, name: string): Promise<boolean> {
  return untilBoard('add_file', { file, name })
}

/** Ask the board, trying again for a few seconds while it is still opening. */
async function untilBoard(name: string, args: unknown): Promise<boolean> {
  const until = Date.now() + 8000
  while (Date.now() < until) {
    const text = await callBoard(name, args, AbortSignal.timeout(1000))
    if (!/^(Stopped\.|Error: the board is not ready\.)$/.test(text))
      return !text.startsWith('Error')
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}...` : s)

/** The tools that change the board, for this turn; the small model gets the short list. */
export function boardTools(env: {
  weak: boolean
  newId: () => string
  emit: (part: ToolPart) => void
  signal: AbortSignal
}): ToolSet {
  const out: ToolSet = {}
  for (const spec of boardToolsFor(env.weak)) {
    out[spec.name] = tool({
      description: spec.description,
      inputSchema: jsonSchema(spec.schema as JSONSchema7),
      execute: async (input: unknown) => {
        const part: ToolPart = {
          type: 'tool',
          id: env.newId(),
          name: spec.name as unknown as ToolName,
          state: 'running',
          detail: ''
        }
        const finish = (state: ToolPart['state'], detail: string, result: string): string => {
          env.emit({ ...part, state, detail })
          return result
        }
        const v = checkBoardCall(spec.name, input)
        if (!v.ok) return finish('error', v.error, `Error: ${v.error}`)
        env.emit(part)
        const text = await callBoard(spec.name, input, env.signal)
        const bad = text.startsWith('Error')
        return finish(bad ? 'error' : 'done', bad ? short(text, 100) : '', text)
      }
    })
  }
  return out
}
