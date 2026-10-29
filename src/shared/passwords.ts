export type SaveDecision = 'save' | 'update' | 'same'

/** What to do with a login that was just submitted, given what is already saved for the site. */
export function classify(
  saved: Array<{ username: string; password: string }>,
  username: string,
  password: string
): SaveDecision {
  const match = saved.find((s) => s.username === username)
  if (!match) return 'save'
  return match.password === password ? 'same' : 'update'
}

/** "https://Example.com/login?x=1" or "example.com" -> "https://example.com". Only http(s) sites qualify. */
export function normalizeOrigin(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

const LOWER = 'abcdefghijkmnopqrstuvwxyz' // no l: easy to misread
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I or O
const DIGITS = '23456789' // no 0 or 1
const SYMBOLS = '!@#$%^&*-_=+?'
const ALL = LOWER + UPPER + DIGITS + SYMBOLS

/**
 * A strong random password with at least one of each kind of character. `random(max)` must return
 * a uniformly distributed integer in [0, max): the caller supplies secure randomness.
 */
export function generatePassword(random: (max: number) => number, length = 20): string {
  const pick = (set: string): string => set[random(set.length)]
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)]
  while (chars.length < length) chars.push(pick(ALL))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/** A form field as the autofill script sees it, in document order. */
export interface FieldInfo {
  type: string
  autocomplete: string
}

const TEXTUAL = new Set(['', 'text', 'email', 'tel'])

/** The username input belonging to the password input at `passwordAt`: the closest text-like one before it. */
export function usernameFieldIndex(fields: FieldInfo[], passwordAt: number): number {
  const before = fields.slice(0, passwordAt)
  const marked = before.map((f) => /\b(username|email)\b/i.test(f.autocomplete))
  for (let i = before.length - 1; i >= 0; i--) {
    if (TEXTUAL.has(before[i].type.toLowerCase()) && (marked[i] || !marked.includes(true))) return i
  }
  return -1
}
