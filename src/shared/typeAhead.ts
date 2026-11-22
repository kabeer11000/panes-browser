/**
 * Typing ahead of a field that is not there yet: Ctrl+T, then typing at once. The field (the address popover, the
 * board's new-card search) mounts a frame or ten later, and the keys pressed meanwhile used to go nowhere. They are
 * kept here and handed to the field when it appears (see renderer/typeAhead.ts).
 */

/** How long after Ctrl+T keys are kept for a field still to come. */
export const TYPE_AHEAD_MS = 1500

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/** The buffer after one key, or null when the key is not typing (a shortcut, an arrow): leave it to the page. */
export function typeAheadKey(buf: string, e: KeyLike): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (e.key === 'Backspace') return buf.slice(0, -1)
  return e.key.length === 1 ? buf + e.key : null
}

/**
 * The buffer to start from when the Ctrl+T message arrives late: the page handles input ahead of queued messages,
 * so a key pressed right after Ctrl+T can be seen before the "start keeping keys" message. Those keys carry the time
 * they were pressed; the ones after Ctrl+T (`since`, epoch ms) are the start of what is being typed.
 */
export function typeAheadSince(keys: readonly (KeyLike & { at: number })[], since: number): string {
  let buf = ''
  for (const e of keys) if (e.at >= since) buf = typeAheadKey(buf, e) ?? buf
  return buf
}
