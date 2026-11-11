import { describe, expect, test } from 'bun:test'
import { quickAction, siteNamed, siteSearchUrl } from './sites'

describe('site searches', () => {
  test('known sites by any name', () => {
    expect(siteNamed('YouTube')?.id).toBe('youtube')
    expect(siteNamed('yt')?.id).toBe('youtube')
    expect(siteNamed('www.youtube.com')?.id).toBe('youtube')
    expect(siteNamed('Twitter')?.id).toBe('x')
    expect(siteNamed('my cooking blog')).toBeNull()
  })
  test('a search address is built and encoded here, never by the model', () => {
    expect(siteSearchUrl('youtube', 'piano covers').url).toBe(
      'https://www.youtube.com/results?search_query=piano+covers'
    )
    expect(siteSearchUrl('YouTube', 'rock & roll / 80s').url).toBe(
      'https://www.youtube.com/results?search_query=rock+%26+roll+%2F+80s'
    )
    // an unknown site: a web search limited to it
    expect(siteSearchUrl('example.org', 'pricing', 'https://duckduckgo.com/?q=').url).toBe(
      'https://duckduckgo.com/?q=site%3Aexample.org%20pricing'
    )
  })
})

describe('quick commands', () => {
  const yt = 'https://www.youtube.com/results?search_query=piano+covers'
  test.each([
    'search piano covers on youtube',
    'Search piano covers on YouTube.',
    'search for piano covers on youtube please',
    'can you search piano covers on youtube',
    'search youtube for piano covers',
    'youtube piano covers',
    'yt: piano covers',
    'find "piano covers" on youtube'
  ])('%s', (text) => {
    const a = quickAction(text)
    expect(a?.kind).toBe('search')
    expect(a && 'url' in a ? a.url : '').toBe(yt)
  })
  test('play and watch play the thing, the search page kept as the fallback', () => {
    for (const text of [
      'play piano covers on youtube',
      'watch piano covers on yt',
      'turn on piano covers on youtube',
      'can you start piano covers on youtube',
      'queue up piano covers on youtube'
    ]) {
      const a = quickAction(text)
      expect(a?.kind).toBe('play')
      expect(a?.url).toBe(yt)
    }
  })
  test('other sites', () => {
    expect(quickAction('play lofi beats on spotify')?.url).toBe(
      'https://open.spotify.com/search/lofi%20beats'
    )
    expect(quickAction('look up octopus on wikipedia')?.url).toBe(
      'https://en.wikipedia.org/w/index.php?search=octopus'
    )
  })
  test.each([
    'open youtube and search for family guy',
    'open youtube and search family guy',
    'go to youtube, search for family guy',
    'open youtube then look up family guy'
  ])('open a site and search it: %s', (text) => {
    const a = quickAction(text)
    expect(a?.kind).toBe('search')
    expect(a && 'url' in a ? a.url : '').toBe(
      'https://www.youtube.com/results?search_query=family+guy'
    )
  })
  test('opening a site', () => {
    expect(quickAction('open youtube')).toMatchObject({
      kind: 'open',
      url: 'https://www.youtube.com/'
    })
    expect(quickAction('take me to github')?.url).toBe('https://github.com/')
  })
  test('questions and vaguer requests go to the model', () => {
    expect(quickAction('what is on my canvas')).toBeNull()
    expect(quickAction('what is on youtube today?')).toBeNull()
    expect(quickAction('summarise this page')).toBeNull()
    expect(quickAction('open the second tab')).toBeNull()
    expect(quickAction('play something relaxing')).toBeNull()
    expect(quickAction('search my history for invoices')).toBeNull()
    expect(quickAction('search for flights to lisbon')).toBeNull()
    expect(quickAction('find tabs about cooking')).toBeNull()
  })
})
