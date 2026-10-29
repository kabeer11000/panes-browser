import { describe, expect, test } from 'bun:test'
import { flagsFor, isPerformanceMode, resolveMode } from './performance'

const GB = 1024 ** 3

describe('resolveMode', () => {
  test('Auto follows memory: Efficient on small machines, Balanced on big ones', () => {
    expect(resolveMode('auto', 4 * GB)).toBe('efficient')
    expect(resolveMode('auto', 8 * GB)).toBe('efficient')
    expect(resolveMode('auto', 16 * GB)).toBe('balanced')
  })

  test('an explicit choice wins whatever the memory', () => {
    expect(resolveMode('balanced', 2 * GB)).toBe('balanced')
    expect(resolveMode('efficient', 64 * GB)).toBe('efficient')
  })

  test('only the three modes are accepted', () => {
    expect(isPerformanceMode('auto')).toBe(true)
    expect(isPerformanceMode('turbo')).toBe(false)
    expect(isPerformanceMode(undefined)).toBe(false)
  })
})

describe('flagsFor', () => {
  test('Efficient shares a process per site and runs in low-end mode; Balanced does not', () => {
    const names = (m: 'balanced' | 'efficient'): string[] => flagsFor(m).switches.map(([k]) => k)
    expect(names('efficient')).toContain('process-per-site')
    expect(names('efficient')).toContain('enable-low-end-device-mode')
    expect(names('balanced')).not.toContain('process-per-site')
    expect(names('balanced')).not.toContain('enable-low-end-device-mode')
  })

  test('the disk cache is capped smaller when saving memory and disk', () => {
    const size = (m: 'balanced' | 'efficient'): number =>
      Number(flagsFor(m).switches.find(([k]) => k === 'disk-cache-size')?.[1])
    expect(size('efficient')).toBeLessThan(size('balanced'))
  })
})
