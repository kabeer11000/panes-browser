import { describe, expect, test } from 'bun:test'
import { chromeMetadata, chromeVersion, windowsPlatformVersion } from './identity'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.169 Safari/537.36'

describe('chromeVersion', () => {
  test('reads the Chrome token and nothing else', () => {
    expect(chromeVersion(UA)).toBe('152.0.7977.169')
    expect(chromeVersion('Mozilla/5.0 Firefox/130.0')).toBeNull()
  })
})

describe('chromeMetadata', () => {
  test('lists Google Chrome next to Chromium, at the user agent version', () => {
    const m = chromeMetadata(UA, 'win32', '10.0.26100', 'x64')!
    expect(m.brands.map((b) => b.brand)).toEqual(['Chromium', 'Google Chrome', 'Not?A_Brand'])
    expect(m.brands.find((b) => b.brand === 'Google Chrome')?.version).toBe('152')
    expect(m.fullVersionList.find((b) => b.brand === 'Google Chrome')?.version).toBe(
      '152.0.7977.169'
    )
    expect(m.platform).toBe('Windows')
    expect(m.mobile).toBe(false)
  })

  test('gives nothing for a user agent that is not Chrome', () => {
    expect(chromeMetadata('Mozilla/5.0 Firefox/130.0', 'win32', '10.0.26100', 'x64')).toBeNull()
  })

  test('arch and platform follow the machine', () => {
    expect(chromeMetadata(UA, 'darwin', '23.0.0', 'arm64')?.architecture).toBe('arm')
    expect(chromeMetadata(UA, 'linux', '6.1.0', 'x64')?.platform).toBe('Linux')
  })
})

describe('windowsPlatformVersion', () => {
  test('maps the build number to the version sites see', () => {
    expect(windowsPlatformVersion('10.0.26100')).toBe('19.0.0')
    expect(windowsPlatformVersion('10.0.22631')).toBe('15.0.0')
    expect(windowsPlatformVersion('10.0.22000')).toBe('13.0.0')
    expect(windowsPlatformVersion('10.0.19045')).toBe('10.0.0')
  })
})

import { wantsChromeIdentity } from './identity'

describe('wantsChromeIdentity', () => {
  test('Google and YouTube sites, in any country, insist on Chrome', () => {
    for (const u of [
      'https://accounts.google.com/signin',
      'https://www.google.co.uk/search?q=x',
      'https://google.de/',
      'https://www.youtube.com/watch?v=1',
      'accounts.youtube.com',
      'https://lh3.googleusercontent.com/a'
    ]) {
      expect(wantsChromeIdentity(u)).toBe(true)
    }
  })
  test('other sites, lookalikes included, get Panes as it is', () => {
    for (const u of [
      'https://dash.cloudflare.com/login',
      'https://example.com/',
      'https://notgoogle.com/',
      'https://google.com.evil.example/',
      'https://mygoogle.co/'
    ]) {
      expect(wantsChromeIdentity(u)).toBe(false)
    }
  })
})
