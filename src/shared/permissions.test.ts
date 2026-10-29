import { describe, expect, test } from 'bun:test'
import { describeKinds, kindsFor, originOf, resolveKinds, type PermKind } from './permissions'

describe('kindsFor', () => {
  test('maps media requests to camera and microphone', () => {
    expect(kindsFor('media', ['video', 'audio'])).toEqual(['camera', 'microphone'])
    expect(kindsFor('media', ['audio'])).toEqual(['microphone'])
    expect(kindsFor('media', [])).toBeNull()
  })

  test('maps the other prompted permissions and refuses the rest', () => {
    expect(kindsFor('geolocation')).toEqual(['location'])
    expect(kindsFor('notifications')).toEqual(['notifications'])
    expect(kindsFor('clipboard-read')).toEqual(['clipboard'])
    expect(kindsFor('display-capture')).toEqual(['screen'])
    expect(kindsFor('usb')).toBeNull()
    expect(kindsFor('midi')).toBeNull()
  })
})

describe('resolveKinds', () => {
  const stored = (m: Partial<Record<PermKind, 'allow' | 'block'>>) => (k: PermKind) => m[k]

  test('allows only when every kind is allowed', () => {
    expect(
      resolveKinds(['camera', 'microphone'], stored({ camera: 'allow', microphone: 'allow' }))
    ).toBe('allow')
    expect(resolveKinds(['camera', 'microphone'], stored({ camera: 'allow' }))).toBe('ask')
  })

  test('one block wins over everything else', () => {
    expect(
      resolveKinds(['camera', 'microphone'], stored({ camera: 'allow', microphone: 'block' }))
    ).toBe('block')
    expect(resolveKinds(['location'], stored({}))).toBe('ask')
  })
})

describe('originOf and describeKinds', () => {
  test('originOf keeps web origins only', () => {
    expect(originOf('https://meet.example.com/room/1?x=2')).toBe('https://meet.example.com')
    expect(originOf('panes://settings')).toBeNull()
    expect(originOf('nonsense')).toBeNull()
  })

  test('describeKinds reads naturally', () => {
    expect(describeKinds(['location'])).toBe('location')
    expect(describeKinds(['camera', 'microphone'])).toBe('camera and microphone')
  })
})
