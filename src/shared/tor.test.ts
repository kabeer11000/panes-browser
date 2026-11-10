import { describe, expect, test } from 'bun:test'
import { buildTorrc, parseBootstrap, snowflakeBridges, snowflakeProgram, torBundleFor } from './tor'

describe('snowflakeProgram', () => {
  test('reads the program from the bundle, refuses anything that is not a plain file name', () => {
    const cfg = (s: string): unknown => ({ pluggableTransports: { snowflake: s } })
    expect(snowflakeProgram(cfg('ClientTransportPlugin snowflake exec ${pt_path}lyrebird.exe'))).toBe(
      'lyrebird.exe'
    )
    expect(snowflakeProgram(cfg('ClientTransportPlugin snowflake exec ${pt_path}lyrebird'))).toBe('lyrebird')
    expect(snowflakeProgram(cfg('ClientTransportPlugin snowflake exec ${pt_path}../evil.exe'))).toBeNull()
    expect(snowflakeProgram({})).toBeNull()
    expect(snowflakeProgram(null)).toBeNull()
  })
})

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
      // the permanent archive first (the main server drops old versions), the main server after
      expect(b?.urls[0].startsWith('https://archive.torproject.org/')).toBe(true)
      expect(b?.urls.some((u) => u.startsWith('https://dist.torproject.org/'))).toBe(true)
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
      snowflake: { exec: 'pluggable_transports\\lyrebird.exe', bridges: ['snowflake 192.0.2.3:80 AB'] }
    })
    // relative and unquoted: Tor would take the quotes and anything after a space as part of the program name
    expect(t).toContain('ClientTransportPlugin snowflake exec pluggable_transports\\lyrebird.exe')
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
