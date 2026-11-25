/**
 * Address and card autofill, as Chrome's: what a form field asks for, what a saved address or card puts in it, and what
 * a submitted form holds that is worth offering to save. Pure, so it is tested; the page side is preload/formFill.ts,
 * the store main/formData.ts.
 */

export interface Address {
  name: string
  organization: string
  street: string
  city: string
  state: string
  postal: string
  country: string
  phone: string
  email: string
}

export interface Card {
  name: string
  number: string
  /** 1 to 12, as text ('' when not known). */
  expMonth: string
  /** Four digits ('' when not known). */
  expYear: string
}

export const EMPTY_ADDRESS: Address = {
  name: '',
  organization: '',
  street: '',
  city: '',
  state: '',
  postal: '',
  country: '',
  phone: '',
  email: ''
}
export const EMPTY_CARD: Card = { name: '', number: '', expMonth: '', expYear: '' }

/** What one field asks for. */
export type FieldKind =
  | 'name'
  | 'given-name'
  | 'family-name'
  | 'organization'
  | 'street'
  | 'line1'
  | 'line2'
  | 'city'
  | 'state'
  | 'postal'
  | 'country'
  | 'phone'
  | 'email'
  | 'cc-name'
  | 'cc-number'
  | 'cc-exp'
  | 'cc-exp-month'
  | 'cc-exp-year'

export const isCardKind = (k: FieldKind): boolean => k.startsWith('cc-')

/** What a page's field says about itself. */
export interface FieldInfo {
  /** input, select or textarea */
  tag: string
  type: string
  autocomplete: string
  name: string
  id: string
  /** Its label's text, aria-label or placeholder. */
  label: string
  maxLength: number
}

/** The autocomplete tokens (the standard way a form says what a field is). */
const TOKENS: Record<string, FieldKind> = {
  name: 'name',
  'given-name': 'given-name',
  'family-name': 'family-name',
  organization: 'organization',
  'street-address': 'street',
  'address-line1': 'line1',
  'address-line2': 'line2',
  'address-level2': 'city',
  'address-level1': 'state',
  'postal-code': 'postal',
  country: 'country',
  'country-name': 'country',
  tel: 'phone',
  'tel-national': 'phone',
  email: 'email',
  'cc-name': 'cc-name',
  'cc-number': 'cc-number',
  'cc-exp': 'cc-exp',
  'cc-exp-month': 'cc-exp-month',
  'cc-exp-year': 'cc-exp-year'
}

/** The names forms give fields that say nothing in autocomplete, most specific first. */
const GUESSES: Array<[RegExp, FieldKind]> = [
  [/card.?holder|name.?on.?card|cc.?name|card.?name/i, 'cc-name'],
  [/card.?num|cc.?num|credit.?card|cardnumber|\bpan\b/i, 'cc-number'],
  [/mm.?\/.?yy|valid.?thru/i, 'cc-exp'],
  [/exp.*month|cc.?month|\bmm\b/i, 'cc-exp-month'],
  [/exp.*year|cc.?year|\byy(yy)?\b/i, 'cc-exp-year'],
  [/expir|\bexp\b|valid.?thru|mm.?\/.?yy/i, 'cc-exp'],
  [/e.?mail/i, 'email'],
  [/first.?name|given.?name|\bfname\b/i, 'given-name'],
  [/last.?name|family.?name|surname|\blname\b/i, 'family-name'],
  [/company|organi[sz]ation|business/i, 'organization'],
  [/full.?name|\bname\b|recipient/i, 'name'],
  [/address.?(line)?.?2|addr2|apartment|suite|\bapt\b/i, 'line2'],
  [/address.?(line)?.?1|addr1|street|address/i, 'line1'],
  [/\bcity\b|town|locality|suburb/i, 'city'],
  [/zip|postal|post.?code|postcode/i, 'postal'],
  [/country/i, 'country'],
  [/state|province|region|county/i, 'state'],
  [/phone|mobile|\btel\b|telephone/i, 'phone']
]

const TEXTUAL = new Set(['', 'text', 'email', 'tel', 'number', 'search'])

/** What a field asks for, or null when it is not one autofill fills (a password, a search box, a checkbox...). */
export function fieldKind(f: FieldInfo): FieldKind | null {
  if (f.tag === 'input' && !TEXTUAL.has(f.type)) return null
  // the last token names it ("shipping street-address", "section-x billing cc-number"); "off" is not one, and as in
  // Chrome the names are read then
  const tokens = f.autocomplete.toLowerCase().trim().split(/\s+/)
  const named = TOKENS[tokens[tokens.length - 1]]
  if (named) return named
  if (f.type === 'email') return 'email'
  if (f.type === 'tel') return 'phone'
  const words = `${f.name} ${f.id} ${f.label}`
  if (/search|captcha|coupon|promo|password|otp|code.?verif/i.test(words)) return null
  for (const [re, kind] of GUESSES) if (re.test(words)) return kind
  return null
}

const digits = (s: string): string => s.replace(/\D/g, '')

/** Whether a card number is well formed (12 to 19 digits, Luhn check). */
export function validCardNumber(number: string): boolean {
  const d = digits(number)
  if (d.length < 12 || d.length > 19) return false
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i])
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return sum % 10 === 0
}

export function cardBrand(number: string): string {
  const d = digits(number)
  if (/^4/.test(d)) return 'Visa'
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard'
  if (/^3[47]/.test(d)) return 'Amex'
  if (/^6(011|5)/.test(d)) return 'Discover'
  if (/^35/.test(d)) return 'JCB'
  if (/^62/.test(d)) return 'UnionPay'
  return 'Card'
}

/** "Visa •••• 4242": how a card is listed (never its whole number). */
export const cardLabel = (c: Card): string =>
  `${cardBrand(c.number)} •••• ${digits(c.number).slice(-4)}`

/** "Expires 04/27", or '' when not known. */
export const cardSub = (c: Card): string =>
  c.expMonth && c.expYear ? `Expires ${c.expMonth.padStart(2, '0')}/${c.expYear.slice(-2)}` : ''

/** How an address is listed: the name, and the first line with the city. */
export const addressLabel = (a: Address): string =>
  a.name || a.organization || a.street.split('\n')[0] || a.email || 'Address'
export const addressSub = (a: Address): string =>
  [a.street.split('\n')[0], a.city].filter(Boolean).join(', ') || a.email || a.phone

const splitName = (name: string): [string, string] => {
  const parts = name.trim().split(/\s+/)
  return parts.length < 2 ? [parts[0] ?? '', ''] : [parts.slice(0, -1).join(' '), parts.at(-1)!]
}

/** What a saved address puts in a field of `kind` ('' for none). */
export function addressValue(kind: FieldKind, a: Address): string {
  const lines = a.street.split('\n')
  switch (kind) {
    case 'name':
      return a.name
    case 'given-name':
      return splitName(a.name)[0]
    case 'family-name':
      return splitName(a.name)[1]
    case 'organization':
      return a.organization
    case 'street':
      return a.street
    case 'line1':
      return lines[0] ?? ''
    case 'line2':
      return lines.slice(1).join(', ')
    case 'city':
      return a.city
    case 'state':
      return a.state
    case 'postal':
      return a.postal
    case 'country':
      return a.country
    case 'phone':
      return a.phone
    case 'email':
      return a.email
    default:
      return ''
  }
}

/** What a saved card puts in a field of `kind`, in the shape the field takes ('' for none). */
export function cardValue(
  kind: FieldKind,
  c: Card,
  f: Pick<FieldInfo, 'maxLength' | 'label'>
): string {
  const mm = c.expMonth ? c.expMonth.padStart(2, '0') : ''
  const yy = c.expYear.slice(-2)
  switch (kind) {
    case 'cc-name':
      return c.name
    case 'cc-number':
      return digits(c.number)
    case 'cc-exp-month':
      return mm
    case 'cc-exp-year':
      // a two-digit box takes 27, a four-digit one 2027
      return f.maxLength === 2 || /\byy\b(?!yy)/i.test(f.label) ? yy : c.expYear
    case 'cc-exp': {
      if (!mm || !yy) return ''
      const long = f.maxLength >= 7 || /yyyy/i.test(f.label)
      return `${mm}/${long ? c.expYear : yy}`
    }
    default:
      return ''
  }
}

/** A month and year read from what was typed in an expiry box ("04/27", "4 / 2027", "0427"). */
export function parseExpiry(s: string): { month: string; year: string } | null {
  const m = s.trim().match(/^(\d{1,2})\s*[/\-. ]?\s*(\d{2}|\d{4})$/)
  if (!m) return null
  const month = Number(m[1])
  if (month < 1 || month > 12) return null
  return { month: String(month), year: m[2].length === 2 ? `20${m[2]}` : m[2] }
}

/**
 * What a submitted form holds worth offering to save: an address with a street and a city or postcode (as Chrome asks
 * for), and a card with a well-formed number.
 */
export function fromSubmitted(fields: ReadonlyArray<{ kind: FieldKind; value: string }>): {
  address: Address | null
  card: Card | null
} {
  const a = { ...EMPTY_ADDRESS }
  const c = { ...EMPTY_CARD }
  let given = ''
  let family = ''
  const lines: string[] = []
  for (const { kind, value: raw } of fields) {
    const value = raw.trim().slice(0, 300)
    if (!value) continue
    if (kind === 'given-name') given = value
    else if (kind === 'family-name') family = value
    else if (kind === 'line1' || kind === 'line2') lines.push(value)
    else if (kind === 'street') lines.push(...value.split('\n'))
    else if (kind === 'cc-name') c.name = value
    else if (kind === 'cc-number') c.number = digits(value)
    else if (kind === 'cc-exp-month') c.expMonth = String(Number(digits(value)) || '')
    else if (kind === 'cc-exp-year')
      c.expYear = digits(value).length === 2 ? `20${digits(value)}` : digits(value)
    else if (kind === 'cc-exp') {
      const e = parseExpiry(value)
      if (e) [c.expMonth, c.expYear] = [e.month, e.year]
    } else if (kind in a) (a as Record<string, string>)[kind] = value
  }
  if (!a.name && (given || family)) a.name = [given, family].filter(Boolean).join(' ')
  a.street = lines.join('\n')
  return {
    address: a.street && (a.city || a.postal) ? a : null,
    card: validCardNumber(c.number) ? c : null
  }
}

const norm = (s: string): string => s.toLowerCase().replace(/\W+/g, '')

/** The same address already saved (same first line and postcode, or city): not offered again. */
export const sameAddress = (x: Address, y: Address): boolean =>
  norm(x.street.split('\n')[0]) === norm(y.street.split('\n')[0]) &&
  (norm(x.postal) === norm(y.postal) || norm(x.city) === norm(y.city))

export const sameCard = (x: Card, y: Card): boolean => digits(x.number) === digits(y.number)
