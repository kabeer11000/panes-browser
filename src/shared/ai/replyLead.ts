// A small model sometimes opens its reply by narrating the request in the third person ("The user is asking me to
// list their tabs."), or with a reasoning block left in. The person never needs that: it is dropped before the reply
// is shown. Only at the very start, and only those sentences: the answer itself is never touched.

const THINK = /^\s*<think>[\s\S]*?<\/think>\s*/i
/** "The user is asking...", "The person wants...", "User asked...": one sentence about the request itself. */
const META =
  /^\s*(?:(?:okay|ok|alright|so|well|hmm)[,.!]?\s+)?(?:the\s+)?(?:user|person)(?:'s)?\s+(?:is|are|was|has|have|had|wants?|wanted|asks?|asked|would\s+like|seems?|needs?|requests?|requested|question\s+is|query\s+is)\b[^.!?\n]*[.!?:]+\s*/i
/** The same, still being written (no sentence end yet): worth waiting for. */
const META_START =
  /^\s*(?:(?:okay|ok|alright|so|well|hmm)[,.!]?\s*)?(?:(?:the\s+)?(?:u(?:s(?:e(?:r)?)?)?|p(?:e(?:r(?:s(?:o(?:n)?)?)?)?)?))?$|^\s*(?:(?:okay|ok|alright|so|well|hmm)[,.!]?\s+)?(?:the\s+)?(?:user|person)\b[^.!?\n]*$/i

/**
 * The start of a reply with any narrating sentences and reasoning blocks taken off. `open`: the start could still
 * turn into one (wait for more text before showing it).
 */
export function cleanLead(text: string): { text: string; open: boolean } {
  let s = text
  for (;;) {
    const think = THINK.exec(s)
    if (think) {
      s = s.slice(think[0].length)
      continue
    }
    if (/^\s*<think>/i.test(s)) return { text: '', open: true }
    const meta = META.exec(s)
    if (meta) {
      s = s.slice(meta[0].length)
      continue
    }
    break
  }
  if (s.length < 200 && META_START.test(s)) return { text: s, open: true }
  return { text: s, open: false }
}

const ACTION =
  /^(?:open|play|watch|listen\s+to|put\s+on|turn\s+(?:on|off|up|down)|switch\s+(?:on|off|to)|start|stream|queue|go\s+to|go\s+back|take\s+me|navigate|launch|visit|close|scroll|pause|resume|unpause|stop|mute|unmute|skip|click|press|type|search|look\s+up|pull\s+up|bring\s+up|download|tidy|arrange|group|connect|rename|hide|filter)\b/i

/**
 * Whether a message asks the browser to do something (open, play, scroll, close...), as opposed to asking a
 * question or for writing. A small model that answers such a request without calling any tool has done nothing,
 * so whatever it says it did (or found) is made up and must not be shown.
 */
export function asksAction(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || t.endsWith('?')) return false
  const s = t.replace(
    /^(?:(?:hey|hi|ok|okay)[,\s]+)?(?:(?:can|could|would|will)\s+you\s+|please\s+|pls\s+|plz\s+|now\s+|just\s+)*/i,
    ''
  )
  return ACTION.test(s)
}
