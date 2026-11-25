import { describe, expect, test } from 'bun:test'
import { AI_SETTINGS, checkSettingChange, describeSettings } from './browserSettings'
import { DEFAULT_SETTINGS } from '../settings'

describe('settings the assistant may change', () => {
  test('never privacy, blocking, files, keys or debugging', () => {
    for (const k of [
      'adblock',
      'httpsFirst',
      'gpc',
      'downloadDir',
      'aiModelsDir',
      'ai',
      'debugPanes',
      'usageStats'
    ])
      expect(k in AI_SETTINGS).toBe(false)
    expect(checkSettingChange('adblock', false).ok).toBe(false)
    expect(checkSettingChange('__proto__', {}).ok).toBe(false)
    expect(checkSettingChange('toString', 'x').ok).toBe(false)
  })
  test('every key is a real setting', () => {
    for (const k of Object.keys(AI_SETTINGS)) expect(k in DEFAULT_SETTINGS).toBe(true)
  })
  test('booleans, also as text', () => {
    expect(checkSettingChange('frostedGlass', true)).toMatchObject({ ok: true, value: true })
    expect(checkSettingChange('frostedGlass', 'false')).toMatchObject({ ok: true, value: false })
    expect(checkSettingChange('frostedGlass', 'yes').ok).toBe(false)
  })
  test('numbers within the Settings page limits', () => {
    expect(checkSettingChange('uiScale', 1.1)).toMatchObject({ ok: true, value: 1.1 })
    expect(checkSettingChange('uiScale', '1.2')).toMatchObject({ ok: true, value: 1.2 })
    expect(checkSettingChange('uiScale', 9).ok).toBe(false)
    expect(checkSettingChange('uiScale', Number.NaN).ok).toBe(false)
  })
  test('choices, case and spaces forgiven', () => {
    expect(checkSettingChange('tabLayout', ' Horizontal ')).toMatchObject({
      ok: true,
      value: 'horizontal'
    })
    expect(checkSettingChange('tabLayout', 'diagonal').ok).toBe(false)
  })
  test('colours as #rrggbb', () => {
    expect(checkSettingChange('accent', 'FB7185')).toMatchObject({ ok: true, value: '#fb7185' })
    expect(checkSettingChange('accent', 'red').ok).toBe(false)
    expect(checkSettingChange('accent', 'url(x)').ok).toBe(false)
  })
  test('the description lists each with its value and what it takes', () => {
    const d = describeSettings(DEFAULT_SETTINGS)
    expect(d).toContain('frostedGlass = false')
    expect(d).toContain('tabLayout = vertical')
    expect(d).toContain('uiScale = 1 (')
  })
})
