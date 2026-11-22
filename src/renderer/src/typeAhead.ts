import { TYPE_AHEAD_MS, typeAheadKey, typeAheadSince, type KeyLike } from '@shared/typeAhead'

/** Keys typed since Ctrl+T while no field had the keyboard; null when not waiting for one. */
let buf: string | null = null
let until = 0
/** Keys seen lately while not waiting, with when they were pressed (epoch ms): Ctrl+T's message may come after them. */
let recent: (KeyLike & { at: number })[] = []

/** When a key was pressed, as epoch ms (the event's own stamp, not when it was handled). */
const pressedAt = (e: Event): number => performance.timeOrigin + e.timeStamp

/**
 * Ctrl+T was pressed (at `since`, epoch ms, when main saw it): keep what is typed until a field takes it
 * (takeTypeAhead), or a moment has passed. Keys already seen that were pressed after Ctrl+T are the start of it.
 */
export function startTypeAhead(since = Date.now()): void {
  buf = typeAheadSince(recent, since)
  recent = []
  until = performance.now() + TYPE_AHEAD_MS
}

/** The field that was waited for is here: what was typed meanwhile, once. */
export function takeTypeAhead(): string {
  const s = buf ?? ''
  buf = null
  return s
}

const isField = (a: Element | null): boolean =>
  a instanceof HTMLElement && a.matches('input, textarea, [contenteditable="true"]')

/** Listens for those keys, before anything else on the page sees them. Once, at start. */
export function installTypeAhead(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (buf === null || performance.now() > until) {
        buf = null
        // not waiting (yet): remember it briefly, in case Ctrl+T's message is still on its way
        if (isField(document.activeElement)) return
        const at = pressedAt(e)
        recent = recent.filter((r) => at - r.at < 1000)
        recent.push({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, at })
        return
      }
      // a field has the keyboard now: the keys are its
      if (isField(document.activeElement)) return
      const next = typeAheadKey(buf, e)
      if (next === null) return
      buf = next
      e.preventDefault()
      e.stopPropagation()
    },
    true
  )
}
