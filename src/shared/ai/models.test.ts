import { describe, expect, test } from 'bun:test'
import { MODELS, RUNTIME_BUILDS, runtimeBuildsFor } from './models'

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
