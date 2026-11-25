/**
 * A page's alert(), confirm() and prompt() on Panes' own card instead of Windows dialogs. The page side (dialogShim)
 * replaces the three in each frame with calls that wait for Panes' answer, as the real ones make the page wait; main
 * asks on the permission card (PermissionManager.confirm). Pure, so it is tested.
 */

export type JsDialogKind = 'alert' | 'confirm' | 'prompt'

/** What a page's dialog says, kept to a readable length (a page could pass a novel). */
export const DIALOG_TEXT_MAX = 2000

/**
 * Replaces alert, confirm and prompt in a page's world. `bridge.ask` waits for the answer (a synchronous call to main).
 * Self-contained (no imports or outer names): Electron runs it from its source text.
 */
export function dialogShim(
  bridge: { ask: (kind: string, message: string, value: string) => unknown },
  g: typeof globalThis = globalThis
): void {
  const text = (v: unknown): string => (v === undefined ? '' : String(v))
  g.alert = function alert(message?: unknown): void {
    bridge.ask('alert', text(message), '')
  }
  g.confirm = function confirm(message?: unknown): boolean {
    return bridge.ask('confirm', text(message), '') === true
  }
  g.prompt = function prompt(message?: unknown, value?: unknown): string | null {
    const r = bridge.ask('prompt', text(message), text(value))
    return typeof r === 'string' ? r : null
  }
}

/** What the page gets back for an answer (`picked` null: put away, as Escape or Cancel). */
export function dialogResult(
  kind: JsDialogKind,
  picked: { index: number; text?: string } | null
): undefined | boolean | string | null {
  if (kind === 'alert') return undefined
  const ok = picked?.index === 1
  if (kind === 'confirm') return ok
  return ok ? (picked?.text ?? '') : null
}

/** A page's dialogs so far: when the last was answered, how many came straight back after an answer, and until when
 *  it is quieted. */
export interface DialogPace {
  answeredAt: number
  rapid: number
  quietUntil: number
}
export const NO_PACE: DialogPace = { answeredAt: 0, rapid: 0, quietUntil: 0 }

/** Asked again sooner than this after an answer: a loop, not a person's pace. */
export const RAPID_MS = 400
/** Past this many in a row straight after answers, the page is quieted (QUIET_MS): its dialogs are Cancel at once. */
export const RAPID_MAX = 3
export const QUIET_MS = 10_000

/**
 * Whether a page's dialog may be shown (a page that throws up dialog after dialog in a loop cannot hold the person
 * hostage; Chrome offers to stop them, this just does). Dialogs at a person's pace are never stopped.
 */
export function dialogAllowed(pace: DialogPace, now: number): { allow: boolean; pace: DialogPace } {
  if (now < pace.quietUntil) return { allow: false, pace }
  const rapid = pace.answeredAt > 0 && now - pace.answeredAt < RAPID_MS ? pace.rapid + 1 : 0
  if (rapid >= RAPID_MAX)
    return { allow: false, pace: { ...pace, rapid: 0, quietUntil: now + QUIET_MS } }
  return { allow: true, pace: { ...pace, rapid } }
}

/** The dialog was answered (or put away) at `now`. */
export const dialogAnswered = (pace: DialogPace, now: number): DialogPace => ({
  ...pace,
  answeredAt: now
})
