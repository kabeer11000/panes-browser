import { app } from 'electron'
import { appendFileSync } from 'fs'
import { join } from 'path'

/**
 * Where startup time goes, for finding it. Off unless PANES_TRACE_STARTUP is set: then each mark is the time in
 * milliseconds since the process started, and one line of them is appended to startup-trace.log in the data folder
 * once the window's page has loaded. Nothing here runs, or is kept, when it is off.
 */
const on = !!process.env['PANES_TRACE_STARTUP']
const marks: Array<[string, number]> = []

export function mark(name: string): void {
  if (on) marks.push([name, Math.round(performance.now())])
}

export function flushTrace(): void {
  if (!on || marks.length === 0) return
  try {
    appendFileSync(
      join(app.getPath('userData'), 'startup-trace.log'),
      marks.map(([name, ms]) => `${name}=${ms}`).join(' ') + '\n'
    )
  } catch {
    // tracing is only an aid: never a reason to fail
  }
  marks.length = 0
}
