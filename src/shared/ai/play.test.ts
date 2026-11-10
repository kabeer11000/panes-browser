import { describe, expect, test } from 'bun:test'
import { feedNewest, latestOf, onDomain, ytFirstChannel, ytFirstVideo } from './play'
import { quickAction } from './sites'

describe('play: parsing', () => {
  test('a play verb on a media site plays, not searches', () => {
    const q = quickAction('play nanou asmrs latest video on youtube')
    expect(q).toMatchObject({ kind: 'play', site: 'YouTube', youtube: true, domain: 'youtube.com' })
    expect(q?.kind === 'play' && q.query).toBe('nanou asmrs latest video')
    expect(quickAction('listen to lofi beats on spotify')).toMatchObject({
      kind: 'play',
      domain: 'spotify.com',
      youtube: false
    })
    expect(quickAction('watch xqc on twitch')).toMatchObject({ kind: 'play', domain: 'twitch.tv' })
  })
  test('search verbs and non-media sites still search', () => {
    expect(quickAction('search piano covers on youtube')?.kind).toBe('search')
    expect(quickAction('watch a review on amazon')?.kind).toBe('search')
  })
  test("a channel's latest upload", () => {
    expect(latestOf("nanou asmr's latest video")).toBe('nanou asmr')
    expect(latestOf('nanou asmrs latest video')).toBe('nanou asmrs')
    expect(latestOf('the newest upload from mkbhd')).toBe('mkbhd')
    expect(latestOf('lofi beats')).toBeNull()
  })
})

describe('play: reading pages', () => {
  const html = `..."adSlotRenderer":{}..."reelItemRenderer":{"videoId":"SHORTSHORT1"},"channelRenderer":{"channelId":"UCabcdefghijklmnopqrstuv","title"},"videoRenderer":{"videoId":"dQw4w9WgXcQ","thumb"}`
  test('first video and channel', () => {
    expect(ytFirstVideo(html)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(ytFirstChannel(html)).toBe('UCabcdefghijklmnopqrstuv')
    expect(ytFirstVideo('<html>consent</html>')).toBeNull()
  })
  test('newest in a feed is the first entry', () => {
    const xml =
      '<feed><entry><yt:videoId>AAAAAAAAAAA</yt:videoId></entry><entry><yt:videoId>BBBBBBBBBBB</yt:videoId></entry></feed>'
    expect(feedNewest(xml)).toBe('https://www.youtube.com/watch?v=AAAAAAAAAAA')
  })
  test('results limited to a domain', () => {
    const r = (url: string): { url: string; title: string; snippet: string } => ({
      url,
      title: '',
      snippet: ''
    })
    expect(
      onDomain(
        [r('https://open.spotify.com/track/1'), r('https://spotify.fan.com/x'), r('bad')],
        'spotify.com'
      )
    ).toEqual([r('https://open.spotify.com/track/1')])
  })
})
