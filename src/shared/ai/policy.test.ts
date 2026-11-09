import { describe, expect, test } from 'bun:test'
import { canShareTab, resolveChatTarget, route, routeChat } from './policy'
import { DEFAULT_AI_SETTINGS, NORMAL_CONTEXT, type AiSettings, type AiTask } from './types'

const on: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  titles: true,
  filenames: true,
  grouping: true,
  canvas: true,
  semanticHistory: true,
  cloudProvider: 'openai',
  cloudForBackground: true
}
const TASKS: AiTask[] = ['title', 'filename', 'group-name', 'embed', 'chat', 'agent']

describe('route', () => {
  test('private and Tor are always denied, whatever else is set', () => {
    for (const task of TASKS) {
      for (const local of [true, false]) {
        expect(route(task, { private: true, tor: false }, on, local)).toBe('deny')
        expect(route(task, { private: false, tor: true }, on, local)).toBe('deny')
        expect(route(task, { private: true, tor: true }, on, local)).toBe('deny')
      }
    }
  })

  test('off by default', () => {
    for (const task of TASKS) expect(route(task, NORMAL_CONTEXT, DEFAULT_AI_SETTINGS)).toBe('deny')
  })

  test('master switch off denies even with features on', () => {
    expect(route('title', NORMAL_CONTEXT, { ...on, enabled: false })).toBe('deny')
  })

  test('a feature switch off denies its task only', () => {
    const s = { ...on, titles: false }
    expect(route('title', NORMAL_CONTEXT, s)).toBe('deny')
    expect(route('filename', NORMAL_CONTEXT, s)).toBe('local')
  })

  test('embedding needs grouping, canvas or semantic history', () => {
    const none = { ...on, grouping: false, canvas: false, semanticHistory: false }
    expect(route('embed', NORMAL_CONTEXT, none)).toBe('deny')
    expect(route('embed', NORMAL_CONTEXT, { ...none, semanticHistory: true })).toBe('local')
    expect(route('embed', NORMAL_CONTEXT, { ...none, canvas: true })).toBe('local')
    expect(route('group-name', NORMAL_CONTEXT, { ...none, canvas: true })).toBe('local')
    expect(route('group-name', NORMAL_CONTEXT, none)).toBe('deny')
  })

  test('background tasks use local when it is available', () => {
    expect(route('title', NORMAL_CONTEXT, on, true)).toBe('local')
  })

  test('cloud only when allowed for background and local is down', () => {
    expect(route('title', NORMAL_CONTEXT, on, false)).toBe('cloud')
    expect(route('title', NORMAL_CONTEXT, { ...on, cloudForBackground: false }, false)).toBe('deny')
    expect(route('title', NORMAL_CONTEXT, { ...on, cloudProvider: null }, false)).toBe('deny')
  })
})

describe('chat and agent', () => {
  const chatOn = { ...DEFAULT_AI_SETTINGS, enabled: true }
  const avail = { local: true, online: ['openai'] as const }

  test('private and Tor tabs are never shared, and a chat turn about them is refused', () => {
    for (const task of ['chat', 'agent'] as const) {
      for (const ctx of [
        { private: true, tor: false },
        { private: false, tor: true }
      ]) {
        expect(canShareTab(task, ctx, chatOn)).toBe(false)
        expect(routeChat(task, ctx, chatOn, avail).route).toBe('deny')
      }
      expect(canShareTab(task, NORMAL_CONTEXT, chatOn)).toBe(true)
    }
  })

  test('chat needs the master switch', () => {
    expect(routeChat('chat', NORMAL_CONTEXT, DEFAULT_AI_SETTINGS, avail).route).toBe('deny')
    expect(canShareTab('chat', NORMAL_CONTEXT, DEFAULT_AI_SETTINGS)).toBe(false)
  })

  test('auto prefers a signed-in provider, ChatGPT first, then the chosen one, then local', () => {
    expect(resolveChatTarget(chatOn, { local: true, online: ['openai', 'chatgpt'] })).toBe(
      'chatgpt'
    )
    expect(
      resolveChatTarget(
        { ...chatOn, cloudProvider: 'google' },
        { local: true, online: ['openai', 'google'] }
      )
    ).toBe('google')
    expect(resolveChatTarget(chatOn, { local: true, online: ['openai'] })).toBe('openai')
    expect(resolveChatTarget(chatOn, { local: true, online: [] })).toBe('local')
    expect(resolveChatTarget(chatOn, { local: false, online: [] })).toBeNull()
  })

  test('a named choice that is not usable gives nothing, never another paid provider', () => {
    const s = { ...chatOn, chatProvider: 'chatgpt' as const }
    expect(resolveChatTarget(s, { local: true, online: ['openai'] })).toBeNull()
    expect(
      resolveChatTarget({ ...s, chatProvider: 'local' }, { local: false, online: ['openai'] })
    ).toBeNull()
    expect(routeChat('chat', NORMAL_CONTEXT, s, { local: true, online: ['chatgpt'] })).toEqual({
      route: 'cloud',
      target: 'chatgpt'
    })
    expect(routeChat('chat', NORMAL_CONTEXT, { ...s, chatProvider: 'local' }, avail)).toEqual({
      route: 'local',
      target: 'local'
    })
  })
})
