import { describe, expect, test } from 'bun:test'
import { SHARP_MAX, sharpWidth } from './sharpPicture'

describe('sharpWidth', () => {
  test('a picture about as wide as it shows is kept', () => {
    expect(sharpWidth(480, 480)).toBeNull()
    expect(sharpWidth(600, 480)).toBeNull()
  })
  test('one shown much wider is retaken at the width it shows, in steps', () => {
    expect(sharpWidth(1000, 480)).toBe(1120)
    expect(sharpWidth(1120, 480)).toBe(1120)
  })
  test('never wider than the cap', () => expect(sharpWidth(9000, 480)).toBe(SHARP_MAX))
  test('nothing known, nothing asked', () => {
    expect(sharpWidth(1000, 0)).toBeNull()
    expect(sharpWidth(0, 480)).toBeNull()
  })
})
