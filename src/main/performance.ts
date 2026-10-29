import { app } from 'electron'
import { readFileSync } from 'fs'
import { totalmem } from 'os'
import { join } from 'path'
import {
  flagsFor,
  isPerformanceMode,
  resolveMode,
  type PerformanceMode,
  type RunningMode
} from '../shared/performance'

let running: RunningMode = 'balanced'

/** The mode this run started in. Switches only count before the app is ready, so changing the setting needs a restart. */
export const runningMode = (): RunningMode => running

/**
 * Read the chosen mode straight from the settings file (the store is not up yet this early) and set
 * Chromium's switches for it. Must run before `app` is ready.
 */
export function applyPerformance(): void {
  let chosen: PerformanceMode = 'auto'
  try {
    const raw = JSON.parse(readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8'))
    if (isPerformanceMode(raw?.performanceMode)) chosen = raw.performanceMode
  } catch {
    // first run, or an unreadable file: Auto
  }
  running = resolveMode(chosen, totalmem())
  const { switches, disableFeatures } = flagsFor(running)
  for (const [name, value] of switches) {
    if (value === undefined) app.commandLine.appendSwitch(name)
    else app.commandLine.appendSwitch(name, value)
  }
  if (disableFeatures.length > 0) {
    app.commandLine.appendSwitch('disable-features', disableFeatures.join(','))
  }
}
