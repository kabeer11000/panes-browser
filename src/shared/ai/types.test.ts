import { describe, expect, test } from 'bun:test'
import {
  CLOUD_EMBED_MODELS,
  CLOUD_LABEL,
  CLOUD_PROVIDERS,
  DEFAULT_CLOUD_MODELS,
  KEY_PROVIDERS,
  OPENROUTER_URL
} from './types'

describe('providers', () => {
  test('the clouds are openai, google and openrouter', () => {
    expect([...CLOUD_PROVIDERS]).toEqual(['openai', 'google', 'openrouter'])
  })

  test('every cloud has a label, a default model and an embedding model', () => {
    for (const p of CLOUD_PROVIDERS) {
      expect(CLOUD_LABEL[p]).toBeTruthy()
      expect(DEFAULT_CLOUD_MODELS[p]).toBeTruthy()
      expect(CLOUD_EMBED_MODELS[p]).toBeTruthy()
    }
  })

  test('the settings page can save a key for these, and not for chatgpt or local', () => {
    expect([...KEY_PROVIDERS].sort()).toEqual([
      'google',
      'openai',
      'openai-compatible',
      'openrouter'
    ])
    expect(KEY_PROVIDERS as readonly string[]).not.toContain('chatgpt')
    expect(KEY_PROVIDERS as readonly string[]).not.toContain('local')
  })

  test('openrouter is reached over https', () => {
    expect(OPENROUTER_URL.startsWith('https://')).toBe(true)
  })
})
