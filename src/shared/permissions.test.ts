import { describe, expect, test } from 'bun:test'
import {
  decisionIn,
  describeKinds,
  kindsFor,
  liveGrants,
  originOf,
  permissionOrigin,
  resolveKinds,
  sanitizeGrants,
  staleKinds,
  withDecision,
  type PageAnswers,
  type PermKind,
  type PermSetting,
  type SiteGrant
} from './permissions'

describe('kindsFor', () => {
  test('maps media requests to camera and microphone', () => {
    expect(kindsFor('media', ['video', 'audio'])).toEqual(['camera', 'microphone'])
    expect(kindsFor('media', ['audio'])).toEqual(['microphone'])
    expect(kindsFor('media', [])).toEqual(['screen']) // getDisplayMedia names no device
  })

  test('maps the other prompted permissions and refuses the rest', () => {
    expect(kindsFor('geolocation')).toEqual(['location'])
    expect(kindsFor('geolocation-approximate')).toEqual(['location'])
    expect(kindsFor('notifications')).toEqual(['notifications'])
    expect(kindsFor('clipboard-read')).toEqual(['clipboard'])
    expect(kindsFor('display-capture')).toEqual(['screen'])
    expect(kindsFor('midi')).toEqual(['midi'])
    expect(kindsFor('midiSysex')).toEqual(['midi'])
    expect(kindsFor('window-management')).toEqual(['windows'])
    expect(kindsFor('usb')).toBeNull()
    expect(kindsFor('idle-detection')).toBeNull()
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

describe('permissionOrigin', () => {
  const top = 'https://meet.example.com/room'

  test('a frame asks on behalf of the page it is in', () => {
    expect(permissionOrigin(['camera'], 'https://widget.other.net/x', top)).toBe(
      'https://meet.example.com'
    )
    expect(permissionOrigin(['camera'], top, top)).toBe('https://meet.example.com')
  })

  test('a cross-origin frame never gets notifications, a same-origin one does', () => {
    expect(permissionOrigin(['notifications'], 'https://ads.other.net/', top)).toBeNull()
    expect(permissionOrigin(['notifications'], 'https://meet.example.com/frame', top)).toBe(
      'https://meet.example.com'
    )
  })

  test('without a page (a service worker) the requester is the site', () => {
    expect(permissionOrigin(['notifications'], 'https://mail.example.com', undefined)).toBe(
      'https://mail.example.com'
    )
  })

  test('non-web requesters and pages are refused', () => {
    expect(permissionOrigin(['camera'], 'panes://settings', undefined)).toBeNull()
    expect(permissionOrigin(['camera'], 'https://a.example/', 'file:///C:/x.html')).toBeNull()
  })
})

describe('grants', () => {
  const o = 'https://a.example'

  test('a newer answer replaces the old one for the same kinds only', () => {
    let g: SiteGrant[] = withDecision([], o, ['camera', 'microphone'], 'allow')
    g = withDecision(g, o, ['camera'], 'block')
    expect(decisionIn(g, o, 'camera', 0)).toBe('block')
    expect(decisionIn(g, o, 'microphone', 0)).toBe('allow')
    expect(g).toHaveLength(2)
  })

  test('null forgets the answer, so the site is asked again', () => {
    const g = withDecision(withDecision([], o, ['location'], 'allow'), o, ['location'], null)
    expect(decisionIn(g, o, 'location', 0)).toBeUndefined()
    expect(g).toEqual([])
  })

  test('"allow this time" holds until it lapses, then counts as no answer', () => {
    const g = withDecision([], o, ['camera'], 'allow', 1000)
    expect(decisionIn(g, o, 'camera', 999)).toBe('allow')
    expect(decisionIn(g, o, 'camera', 1000)).toBeUndefined()
    expect(liveGrants(g, 999)).toHaveLength(1)
    expect(liveGrants(g, 1000)).toEqual([])
  })

  test('a saved answer replaces a temporary one and does not lapse', () => {
    let g = withDecision([], o, ['camera'], 'allow', 1000)
    g = withDecision(g, o, ['camera'], 'allow')
    expect(decisionIn(g, o, 'camera', 10 ** 12)).toBe('allow')
  })

  test('answers are per site', () => {
    const g = withDecision([], o, ['camera'], 'allow')
    expect(decisionIn(g, 'https://b.example', 'camera', 0)).toBeUndefined()
  })

  test('sanitizeGrants keeps well-formed answers, one per site and kind', () => {
    expect(
      sanitizeGrants([
        { origin: 'https://a.example/path', kind: 'camera', decision: 'allow' },
        { origin: 'https://a.example', kind: 'camera', decision: 'block' },
        { origin: 'panes://settings', kind: 'camera', decision: 'allow' },
        { origin: 'https://b.example', kind: 'usb', decision: 'allow' },
        { origin: 'https://b.example', kind: 'location', decision: 'maybe' },
        null
      ])
    ).toEqual([{ origin: 'https://a.example', kind: 'camera', decision: 'block' }])
    expect(sanitizeGrants('nope')).toEqual([])
  })
})

describe('staleKinds', () => {
  const settings =
    (m: Partial<Record<PermKind, PermSetting>>) =>
    (k: PermKind): PermSetting =>
      m[k] ?? 'ask'

  test('a page that never asked needs nothing', () => {
    expect(staleKinds({}, settings({ camera: 'allow' }))).toEqual([])
  })

  test('nothing changed since the page was told: nothing to do', () => {
    const told: PageAnswers = { camera: { granted: false, setting: 'block' } }
    expect(staleKinds(told, settings({ camera: 'block' }))).toEqual([])
  })

  test('a refused page that may now have access has to reload', () => {
    const told: PageAnswers = {
      camera: { granted: false, setting: 'block' },
      location: { granted: false, setting: 'ask' } // dismissed
    }
    expect(staleKinds(told, settings({ camera: 'ask', location: 'allow' }))).toEqual([
      'camera',
      'location'
    ])
  })

  test('a dismissed request with the setting unchanged is not stale', () => {
    const told: PageAnswers = { location: { granted: false, setting: 'ask' } }
    expect(staleKinds(told, settings({}))).toEqual([])
  })

  test('blocking what cannot be taken back live needs a reload; capture and notifications do not', () => {
    const told: PageAnswers = {
      camera: { granted: true, setting: 'allow' },
      notifications: { granted: true, setting: 'allow' },
      location: { granted: true, setting: 'allow' }
    }
    const blocked = settings({ camera: 'block', notifications: 'block', location: 'block' })
    expect(staleKinds(told, blocked)).toEqual(['location'])
  })

  test('a lapsed "this time" answer back to Ask leaves the page as it is', () => {
    const told: PageAnswers = { location: { granted: true, setting: 'allow' } }
    expect(staleKinds(told, settings({}))).toEqual([])
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
    expect(describeKinds(['midi'])).toBe('MIDI devices')
  })
})
