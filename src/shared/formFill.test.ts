import { describe, expect, test } from 'bun:test'
import {
  addressValue,
  cardLabel,
  cardSub,
  cardValue,
  EMPTY_ADDRESS,
  fieldKind,
  fromSubmitted,
  parseExpiry,
  sameAddress,
  validCardNumber,
  type FieldInfo
} from './formFill'

const field = (o: Partial<FieldInfo>): FieldInfo => ({
  tag: 'input',
  type: 'text',
  autocomplete: '',
  name: '',
  id: '',
  label: '',
  maxLength: -1,
  ...o
})

describe('fieldKind', () => {
  test('the autocomplete token wins, with sections and shipping/billing before it', () => {
    expect(fieldKind(field({ autocomplete: 'shipping street-address' }))).toBe('street')
    expect(fieldKind(field({ autocomplete: 'section-a billing cc-number' }))).toBe('cc-number')
    expect(fieldKind(field({ autocomplete: 'address-level2' }))).toBe('city')
  })
  test('names and labels when autocomplete says nothing (or off)', () => {
    expect(fieldKind(field({ name: 'firstName' }))).toBe('given-name')
    expect(fieldKind(field({ name: 'fullname', label: 'Full name' }))).toBe('name')
    expect(fieldKind(field({ name: 'lname' }))).toBe('family-name')
    expect(fieldKind(field({ name: 'billing_zip', autocomplete: 'off' }))).toBe('postal')
    expect(fieldKind(field({ label: 'Name on card' }))).toBe('cc-name')
    expect(fieldKind(field({ label: 'Card number' }))).toBe('cc-number')
    expect(fieldKind(field({ label: 'Expiry (MM/YY)' }))).toBe('cc-exp')
    expect(fieldKind(field({ name: 'exp_month', tag: 'select', type: 'select-one' }))).toBe(
      'cc-exp-month'
    )
    expect(fieldKind(field({ name: 'email_address' }))).toBe('email')
    expect(fieldKind(field({ label: 'Company name' }))).toBe('organization')
    expect(fieldKind(field({ label: 'Country/Region' }))).toBe('country')
    expect(fieldKind(field({ name: 'address2' }))).toBe('line2')
  })
  test('not a field it fills', () => {
    expect(fieldKind(field({ type: 'password', name: 'address' }))).toBeNull()
    expect(fieldKind(field({ type: 'checkbox', name: 'email' }))).toBeNull()
    expect(fieldKind(field({ name: 'q', label: 'Search addresses' }))).toBeNull()
    expect(fieldKind(field({ name: 'username' }))).toBeNull()
    expect(fieldKind(field({ name: 'promo_code' }))).toBeNull()
  })
})

describe('cards', () => {
  test('Luhn and length', () => {
    expect(validCardNumber('4242 4242 4242 4242')).toBe(true)
    expect(validCardNumber('4242 4242 4242 4241')).toBe(false)
    expect(validCardNumber('1234')).toBe(false)
  })
  test('listed by brand and last four, never the whole number', () => {
    const c = { name: 'A B', number: '5555555555554444', expMonth: '4', expYear: '2027' }
    expect(cardLabel(c)).toBe('Mastercard •••• 4444')
    expect(cardSub(c)).toBe('Expires 04/27')
  })
  test('expiry in the shape the field takes', () => {
    const c = { name: '', number: '', expMonth: '4', expYear: '2027' }
    expect(cardValue('cc-exp', c, { maxLength: 5, label: '' })).toBe('04/27')
    expect(cardValue('cc-exp', c, { maxLength: -1, label: 'MM/YYYY' })).toBe('04/2027')
    expect(cardValue('cc-exp-year', c, { maxLength: 2, label: '' })).toBe('27')
    expect(cardValue('cc-exp-year', c, { maxLength: -1, label: '' })).toBe('2027')
    expect(cardValue('cc-exp-month', c, { maxLength: -1, label: '' })).toBe('04')
  })
  test('expiry read back from what was typed', () => {
    expect(parseExpiry('04/27')).toEqual({ month: '4', year: '2027' })
    expect(parseExpiry('4 / 2028')).toEqual({ month: '4', year: '2028' })
    expect(parseExpiry('13/27')).toBeNull()
    expect(parseExpiry('soon')).toBeNull()
  })
})

describe('addresses', () => {
  const a = {
    ...EMPTY_ADDRESS,
    name: 'Ada Lovelace',
    street: '12 St James Sq\nFlat 3',
    city: 'London',
    postal: 'SW1Y 4JH'
  }
  test('split into the fields a form has', () => {
    expect(addressValue('given-name', a)).toBe('Ada')
    expect(addressValue('family-name', a)).toBe('Lovelace')
    expect(addressValue('line1', a)).toBe('12 St James Sq')
    expect(addressValue('line2', a)).toBe('Flat 3')
    expect(addressValue('cc-number', a)).toBe('')
  })
  test('a submitted form: an address needs a street and a city or postcode; a card a good number', () => {
    const got = fromSubmitted([
      { kind: 'given-name', value: 'Ada' },
      { kind: 'family-name', value: 'Lovelace' },
      { kind: 'line1', value: '12 St James Sq' },
      { kind: 'line2', value: 'Flat 3' },
      { kind: 'city', value: 'London' },
      { kind: 'cc-number', value: '4242 4242 4242 4242' },
      { kind: 'cc-exp', value: '04/27' }
    ])
    expect(got.address?.name).toBe('Ada Lovelace')
    expect(got.address?.street).toBe('12 St James Sq\nFlat 3')
    expect(got.card).toEqual({
      name: '',
      number: '4242424242424242',
      expMonth: '4',
      expYear: '2027'
    })
    expect(fromSubmitted([{ kind: 'city', value: 'London' }]).address).toBeNull()
    expect(fromSubmitted([{ kind: 'cc-number', value: '4242' }]).card).toBeNull()
  })
  test('the same address is not offered again', () => {
    expect(sameAddress(a, { ...a, street: '12 St. James Sq', name: 'A L' })).toBe(true)
    expect(sameAddress(a, { ...a, street: '13 St James Sq' })).toBe(false)
  })
})
