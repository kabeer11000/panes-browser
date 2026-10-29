export type PerformanceMode = 'auto' | 'balanced' | 'efficient'
export type RunningMode = Exclude<PerformanceMode, 'auto'>

/** At or below this much memory, Auto picks Efficient: that is where saving a few hundred MB matters. */
export const AUTO_EFFICIENT_BELOW_GB = 9

const GB = 1024 ** 3

/** Auto means "decide from this computer's memory"; the other two are taken as given. */
export function resolveMode(mode: PerformanceMode, totalMemBytes: number): RunningMode {
  if (mode === 'auto')
    return totalMemBytes < AUTO_EFFICIENT_BELOW_GB * GB ? 'efficient' : 'balanced'
  return mode
}

export const isPerformanceMode = (v: unknown): v is PerformanceMode =>
  v === 'auto' || v === 'balanced' || v === 'efficient'

export interface ChromiumFlags {
  /** Plain switches, optionally with a value. */
  switches: Array<[string, string?]>
  /** Chromium features to turn off (they share one switch, so they are merged here). */
  disableFeatures: string[]
}

const CACHE_BYTES = { balanced: 512 * 1024 ** 2, efficient: 256 * 1024 ** 2 } as const

/**
 * The Chromium switches for a mode. Measured on a window with eight tabs of one site open:
 * `process-per-site` alone halves the processes (12 to 5) and takes about 20% off private memory,
 * low-end-device mode about 9% more, and dropping the spare renderer a little more. Tabs on the same
 * site then share a process (different sites never do), so Efficient trades some isolation between
 * same-site tabs for memory; Balanced keeps one process per tab.
 */
export function flagsFor(mode: RunningMode): ChromiumFlags {
  // FedCm: Google's sign-in tries the browser's own account chooser first, which embedded Chromium does not have
  // ("FedCM get() rejects with NetworkError"), and only falls back to the pop-up when the API is simply absent.
  const disableFeatures = ['SpareRendererForSitePerProcess', 'FedCm', 'FedCmAutoReauthn']
  const switches: Array<[string, string?]> = [['disk-cache-size', String(CACHE_BYTES[mode])]]
  if (mode === 'efficient') {
    switches.push(['process-per-site'], ['enable-low-end-device-mode'])
  }
  return { switches, disableFeatures }
}
