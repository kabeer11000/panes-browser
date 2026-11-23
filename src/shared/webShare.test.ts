import { describe, expect, test } from 'bun:test'
import { parseShareData, webShareShim } from './webShare'

const world = (active = true): { g: typeof globalThis; sent: string[] } => {
  const sent: string[] = []
  const nav = { userActivation: { isActive: active } } as unknown as Navigator
  const g = {
    navigator: nav,
    location: { href: 'https://site.test/a/b' }
  } as unknown as typeof globalThis
  return { g, sent }
}

describe('navigator.share for pages', () => {
  test('a link is shared through Panes (made absolute); cancelling rejects with AbortError', async () => {
    const { g, sent } = world()
    let answer = true
    webShareShim({ share: async (d) => (sent.push(d), answer) }, g)
    const nav = g.navigator as unknown as {
      share: (d: unknown) => Promise<void>
      canShare: (d: unknown) => boolean
    }
    await nav.share({ title: 'T', url: '/page' })
    expect(JSON.parse(sent[0])).toEqual({ title: 'T', text: '', url: 'https://site.test/page' })
    answer = false
    await expect(nav.share({ text: 'hi' })).rejects.toThrow('Share canceled')
    expect(nav.canShare({ url: 'https://x.test' })).toBe(true)
    expect(nav.canShare({ files: [{}] })).toBe(false)
  })
  test('without a click, or with nothing to share, it refuses', async () => {
    const { g } = world(false)
    webShareShim({ share: async () => true }, g)
    const nav = g.navigator as unknown as { share: (d: unknown) => Promise<void> }
    await expect(nav.share({ url: 'https://x.test' })).rejects.toThrow('user gesture')
    await expect(nav.share({})).rejects.toThrow('Nothing to share')
  })
  test('what arrives in main is checked', () => {
    expect(parseShareData({ url: 'javascript:alert(1)', title: 'x' })).toEqual({
      title: 'x',
      text: '',
      url: ''
    })
    expect(parseShareData({})).toBeNull()
    expect(parseShareData('nope')).toBeNull()
  })
})
