import { describe, expect, test } from 'bun:test'
import {
  cpuOnlyHolds,
  nextGpuFails,
  CPU_ONLY_DAYS,
  MODELS,
  RUNTIME_BUILDS,
  runtimeBuildsFor,
  slowForLocal
} from './models'

const all = [...RUNTIME_BUILDS, ...Object.values(MODELS)]

describe('pinned downloads', () => {
  test('every url is https, every hash 64 hex, every size positive', () => {
    for (const d of all) {
      expect(d.url.startsWith('https://')).toBe(true)
      expect(d.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(d.size).toBeGreaterThan(0)
    }
  })

  test('hashes are all different', () => {
    expect(new Set(all.map((d) => d.sha256)).size).toBe(all.length)
  })

  test('size budgets', () => {
    expect(MODELS.embed.size).toBeLessThanOrEqual(350 * 1e6)
    expect(MODELS.chat.size).toBeLessThanOrEqual(2.5 * 1e9)
  })

  test('GPU build is preferred, CPU is the fallback', () => {
    expect(runtimeBuildsFor('win32', 'x64').map((b) => b.gpu)).toEqual([true, false])
    expect(runtimeBuildsFor('linux', 'x64').map((b) => b.gpu)).toEqual([true, false])
    expect(runtimeBuildsFor('darwin', 'arm64')).toHaveLength(1)
    expect(runtimeBuildsFor('freebsd', 'x64')).toHaveLength(0)
  })

  test('build ids are unique', () => {
    expect(new Set(RUNTIME_BUILDS.map((b) => b.id)).size).toBe(RUNTIME_BUILDS.length)
  })
})

describe('cpuOnlyHolds', () => {
  const now = 1_800_000_000_000
  const day = 86_400_000
  test('GPU failures on two launches hold; an old record or one with no time does not', () => {
    expect(cpuOnlyHolds({ cpuOnly: true, at: now - day, fails: 2 }, now)).toBe(true)
    expect(cpuOnlyHolds({ cpuOnly: true, at: now - CPU_ONLY_DAYS * day, fails: 2 }, now)).toBe(
      false
    )
    expect(cpuOnlyHolds({ cpuOnly: true, fails: 2 }, now)).toBe(false)
    expect(cpuOnlyHolds({ cpuOnly: false, at: now }, now)).toBe(false)
    expect(cpuOnlyHolds(null, now)).toBe(false)
    expect(cpuOnlyHolds({ cpuOnly: true, at: now + day, fails: 2 }, now)).toBe(false) // a clock set back
  })
  test('one failed GPU start is not enough: the next launch tries the GPU again', () => {
    // a first start can fail on a slow first shader compile; this pinned a GTX 1070 to the CPU for a week (8x slower)
    expect(cpuOnlyHolds({ cpuOnly: true, at: now - day, fails: 1 }, now)).toBe(false)
    expect(cpuOnlyHolds({ cpuOnly: true, at: now - day }, now)).toBe(false) // older records counted one failure
  })
  test('failures add up within the hold, and start over after it', () => {
    expect(nextGpuFails({ cpuOnly: true, at: now - day, fails: 1 }, now)).toBe(2)
    expect(nextGpuFails({ cpuOnly: true, at: now - day }, now)).toBe(2)
    expect(nextGpuFails({ cpuOnly: true, at: now - CPU_ONLY_DAYS * day, fails: 3 }, now)).toBe(1)
    expect(nextGpuFails(null, now)).toBe(1)
  })
})

describe('slowForLocal', () => {
  const GB = 2 ** 30
  test('under 8 GB or fewer than 4 threads is slow; an ordinary laptop is not', () => {
    expect(slowForLocal(4 * GB, 8)).toBe(true)
    expect(slowForLocal(16 * GB, 2)).toBe(true)
    expect(slowForLocal(8 * GB, 8)).toBe(false)
    expect(slowForLocal(7.8 * GB, 4)).toBe(false) // 8 GB as the system reports it
  })
})
