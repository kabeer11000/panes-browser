import { describe, expect, test } from 'bun:test'
import { choiceLabels, deviceLabel, MAX_CHOICES } from './devices'

describe('device chooser labels', () => {
  test('a named device by its name, tidied', () => {
    expect(deviceLabel({ id: '1', name: '  Keychron   K2 ' })).toBe('Keychron K2')
  })
  test('no name: vendor and product as four hex digits, from numbers or strings', () => {
    expect(deviceLabel({ id: '1', vendorId: 0x2341, productId: 0x43 })).toBe(
      'Unknown device (2341:0043)'
    )
    expect(deviceLabel({ id: '1', vendorId: '2341', productId: '0043' })).toBe(
      'Unknown device (2341:0043)'
    )
    expect(deviceLabel({ id: '1' })).toBe('Unknown device')
  })
  test('same names are numbered, others left alone', () => {
    expect(
      choiceLabels([
        { id: 'a', name: 'Arduino Uno' },
        { id: 'b', name: 'Ledger' },
        { id: 'c', name: 'Arduino Uno' }
      ])
    ).toEqual(['Arduino Uno (1)', 'Ledger', 'Arduino Uno (2)'])
  })
  test('at most MAX_CHOICES', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `D${i}` }))
    expect(choiceLabels(many)).toHaveLength(MAX_CHOICES)
  })
})
