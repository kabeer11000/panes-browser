import { describe, expect, test } from 'bun:test'
import { cleanBatch, hasUsage, ramTier } from './usage'

const ok = {
  id: 'a1b2c3d4-e5f6',
  v: '0.1.0-beta.150',
  os: 'win32 10.0.26300',
  ram: 16,
  active: 300,
  actions: { 'tabs:create': 3, 'canvas:open': 1 },
  sites: { 'youtube.com': 120 }
}

describe('cleanBatch', () => {
  test('keeps a good batch', () => {
    expect(cleanBatch(ok)).toEqual(ok)
    expect(cleanBatch({ ...ok, boot: 812.4 })?.boot).toBe(812)
  })
  test('refuses anything off', () => {
    expect(cleanBatch(null)).toBeNull()
    expect(cleanBatch({ ...ok, id: 'x' })).toBeNull()
    expect(cleanBatch({ ...ok, os: 'a'.repeat(41) })).toBeNull()
    expect(cleanBatch({ ...ok, active: -1 })).toBeNull()
    expect(cleanBatch({ ...ok, boot: 'soon' })).toBeNull()
    expect(cleanBatch({ ...ok, actions: [] })).toBeNull()
    // keys are names, never text someone typed
    expect(cleanBatch({ ...ok, sites: { 'https://a.com/?q=secret': 1 } })).toBeNull()
    expect(cleanBatch({ ...ok, actions: { 'tabs:create': Infinity } })).toBeNull()
    const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`k${i}`, 1]))
    expect(cleanBatch({ ...ok, actions: many })).toBeNull()
  })
})

test('ramTier rounds to a power of two between 4 and 64', () => {
  const gb = 1024 ** 3
  expect(ramTier(15.8 * gb)).toBe(16)
  expect(ramTier(2 * gb)).toBe(4)
  expect(ramTier(12 * gb)).toBe(16)
  expect(ramTier(256 * gb)).toBe(64)
})

test('hasUsage', () => {
  expect(hasUsage({ ...ok, active: 0, actions: {} })).toBe(false)
  expect(hasUsage(ok)).toBe(true)
})
