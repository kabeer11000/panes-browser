import { describe, expect, test } from 'bun:test'
import { isMuted, muteAfterSiteChange, toggledTabMute } from './mute'

describe('tab and site mute', () => {
  test('no choice of its own: follows the site', () => {
    expect(isMuted(undefined, false)).toBe(false)
    expect(isMuted(undefined, true)).toBe(true)
  })
  test('the tab muted on its own stays muted when its site is unmuted', () => {
    expect(isMuted('on', false)).toBe(true)
  })
  test('unmuting one tab of a muted site hears just that tab', () => {
    const t = toggledTabMute(undefined, true)
    expect(t).toBe('off')
    expect(isMuted(t, true)).toBe(false)
  })
  test('toggling twice comes back to silent', () => {
    expect(isMuted(toggledTabMute(toggledTabMute(undefined, false), false), false)).toBe(false)
    expect(isMuted(toggledTabMute(undefined, false), false)).toBe(true)
  })
  test('going to another site keeps a mute, drops a site exception', () => {
    expect(muteAfterSiteChange('on')).toBe('on')
    expect(muteAfterSiteChange('off')).toBeUndefined()
    expect(isMuted(muteAfterSiteChange('off'), true)).toBe(true) // the next muted site is silent again
    expect(isMuted(muteAfterSiteChange(undefined), false)).toBe(false) // leaving a muted site: heard
  })
})
