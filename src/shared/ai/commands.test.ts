import { describe, expect, test } from 'bun:test'
import { quickCommand, tabNamed, type CommandTab } from './commands'
import { validateToolInput } from './chatTools'

const TABS: CommandTab[] = [
  { id: 4, title: 'Settings', url: 'panes://settings', active: true },
  {
    id: 7,
    title: 'lofi hip hop radio - YouTube',
    url: 'https://www.youtube.com/watch?v=x',
    active: false,
    audible: true
  },
  {
    id: 9,
    title: 'Apollo 11 - Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Apollo_11',
    active: false
  },
  { id: 12, title: 'Pricing - Vercel', url: 'https://vercel.com/pricing', active: false }
]
const call = (s: string, tabs = TABS): unknown => quickCommand(s, tabs)?.call ?? null

describe('quickCommand: scrolling the current tab', () => {
  test('directions', () => {
    expect(call('scroll down')).toEqual({ name: 'scroll_page', tabId: 4, direction: 'down' })
    expect(call('Scroll up a bit please')).toEqual({
      name: 'scroll_page',
      tabId: 4,
      direction: 'up'
    })
    expect(call('can you scroll down')).toEqual({
      name: 'scroll_page',
      tabId: 4,
      direction: 'down'
    })
    expect(call('go to the top of the page')).toEqual({
      name: 'scroll_page',
      tabId: 4,
      direction: 'top'
    })
    expect(call('scroll to the bottom')).toEqual({
      name: 'scroll_page',
      tabId: 4,
      direction: 'bottom'
    })
  })
  test('to a part of the page', () => {
    expect(call('can you scroll to ai settings on my current tab')).toEqual({
      name: 'scroll_to',
      tabId: 4,
      target: 'ai settings'
    })
    expect(call('jump to the comments section')).toEqual({
      name: 'scroll_to',
      tabId: 4,
      target: 'comments'
    })
  })
})

describe('quickCommand: media', () => {
  test('goes to the tab playing sound when none is named', () => {
    expect(call('pause')).toEqual({ name: 'media_control', tabId: 7, action: 'pause', amount: 1 })
    expect(call('pause the video')).toMatchObject({ tabId: 7, action: 'pause' })
    expect(call('resume the music')).toMatchObject({ tabId: 7, action: 'play' })
    expect(call('mute it')).toMatchObject({ tabId: 7, action: 'mute' })
  })
  test('a named tab wins', () => {
    const quiet = TABS.map((t) => ({ ...t, audible: false }))
    expect(call('pause the youtube video', quiet)).toMatchObject({ tabId: 7, action: 'pause' })
    expect(call('mute the video on wikipedia', quiet)).toMatchObject({ tabId: 9, action: 'mute' })
    // nothing playing and nothing named: the current tab
    expect(call('pause', quiet)).toMatchObject({ tabId: 4 })
  })
  test('skips', () => {
    expect(call('skip 30 seconds')).toEqual({
      name: 'media_control',
      tabId: 7,
      action: 'skip',
      amount: 30
    })
    expect(call('go back 10s')).toMatchObject({ action: 'skip', amount: -10 })
    expect(call('skip ahead 2 minutes')).toMatchObject({ amount: 120 })
  })
  test('a tab named but not found goes to the model', () => {
    expect(call('pause the video on netflix')).toBeNull()
  })
})

describe('quickCommand: tabs and finding', () => {
  test('switches to a tab named by title or site', () => {
    expect(call('go to my youtube tab')).toEqual({ name: 'switch_to_tab', tabId: 7 })
    expect(call('switch to the vercel tab')).toEqual({ name: 'switch_to_tab', tabId: 12 })
    expect(call('go to my netflix tab')).toBeNull()
  })
  test('finds words on the current tab', () => {
    expect(call('find the word pricing on this page')).toEqual({
      name: 'find_in_page',
      tabId: 4,
      text: 'pricing'
    })
    expect(call('highlight "terms of use" on the page')).toMatchObject({ text: 'terms of use' })
  })
})

describe('quickCommand: leaves everything else to the model', () => {
  test('questions, searches and vaguer requests', () => {
    for (const s of [
      'what are my tabs',
      'how do I scroll down on a mac?',
      'play lofi',
      'play piano covers on youtube', // quickAction's
      'summarize this page',
      'scroll down and then tell me what the article says about the budget, the timeline and the people involved in detail',
      'pause'.repeat(30)
    ])
      expect(call(s)).toBeNull()
  })
  test('no tabs at all: nothing to act on', () => {
    expect(call('scroll down', [])).toBeNull()
    expect(call('pause', [])).toBeNull()
  })
  test('every call it makes passes the same checks as a model’s', () => {
    for (const s of [
      'scroll down',
      'jump to comments',
      'pause the video',
      'skip 30 seconds',
      'go to my youtube tab',
      'find pricing on this page'
    ]) {
      const c = quickCommand(s, TABS)
      expect(c).not.toBeNull()
      const { name, ...args } = c!.call
      expect(validateToolInput(name, args).ok).toBe(true)
    }
  })
})

describe('tabNamed', () => {
  test('one match by title or host, else null', () => {
    expect(tabNamed('youtube', TABS)?.id).toBe(7)
    expect(tabNamed('my apollo', TABS)?.id).toBe(9)
    expect(tabNamed('the tab', TABS)).toBeNull()
    expect(tabNamed('e', TABS)).toBeNull()
  })
})
