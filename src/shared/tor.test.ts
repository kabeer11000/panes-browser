import { describe, expect, test } from 'bun:test'
import { buildTorrc, parseBootstrap, snowflakeBridges, torBundleFor } from './tor'

describe('torBundleFor', () => {
  test('has a pinned build with a checksum for the common platforms', () => {
    for (const [p, a] of [
      ['win32', 'x64'],
      ['linux', 'x64'],
      ['darwin', 'arm64'],
      ['darwin', 'x64']
    ]) {
      const b = torBundleFor(p, a)
      expect(b?.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(b?.url.startsWith('https://dist.torproject.org/')).toBe(true)
    }
    expect(torBundleFor('win32', 'arm64')).toBeNull()
  })
})

describe('buildTorrc', () => {
  const base = { socksPort: 9150, dataDir: 'C:\\Users\\a b\\tor', geoip: 'g', geoip6: 'g6' }
  test('quotes paths and keeps the proxy on localhost only', () => {
    const t = buildTorrc(base)
    expect(t).toContain('SocksPort 127.0.0.1:9150')
    expect(t).toContain('DataDirectory "C:/Users/a b/tor"')
    expect(t).not.toContain('UseBridges')
  })
  test('adds the Snowflake transport and its bridges', () => {
    const t = buildTorrc({
      ...base,
      snowflake: { exec: 'C:\\x\\snowflake-client.exe', bridges: ['snowflake 192.0.2.3:80 AB'] }
    })
    expect(t).toContain('ClientTransportPlugin snowflake exec "C:/x/snowflake-client.exe"')
    expect(t).toContain('UseBridges 1')
    expect(t).toContain('Bridge snowflake 192.0.2.3:80 AB')
  })
  test('no bridges, no bridge mode', () => {
    expect(buildTorrc({ ...base, snowflake: { exec: 'x', bridges: [] } })).not.toContain(
      'UseBridges'
    )
  })
})

describe('parseBootstrap', () => {
  test('reads the percentage from the log line', () => {
    expect(parseBootstrap('Oct 29 [notice] Bootstrapped 45% (loading_descriptors): Loading')).toBe(
      45
    )
    expect(parseBootstrap('Bootstrapped 100% (done): Done')).toBe(100)
    expect(parseBootstrap('some other line')).toBeNull()
  })
})

describe('snowflakeBridges', () => {
  test('takes the snowflake lines of a pt_config and ignores the rest', () => {
    expect(
      snowflakeBridges({ bridges: { snowflake: ['snowflake 1.2.3.4:1 FP', 42, 'obfs4 x'] } })
    ).toEqual(['snowflake 1.2.3.4:1 FP'])
    expect(snowflakeBridges(null)).toEqual([])
    expect(snowflakeBridges({ bridges: {} })).toEqual([])
  })
})
