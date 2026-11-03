import type { ImportSource } from '@shared/types'

let early: Promise<ImportSource[]> | null = null

/** Start looking for other browsers ahead of time (the welcome tour does, a step early), so the list is there when shown. */
export function preloadImportSources(): void {
  early ??= window.panesInternal.importSources()
}

/** The browsers to offer: a preloaded answer is used once, and a later visit looks again in case one came or went. */
export function takeImportSources(): Promise<ImportSource[]> {
  const found = early ?? window.panesInternal.importSources()
  early = null
  return found
}
