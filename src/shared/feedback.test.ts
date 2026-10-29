import { describe, expect, test } from 'bun:test'
import { FEEDBACK_EMAIL, feedbackUrl } from './feedback'

const ctx = {
  version: '0.1.0-alpha.24',
  chrome: '140.0.1',
  platform: 'win32',
  arch: 'x64',
  os: '10.0.26300'
}

describe('feedbackUrl', () => {
  test('is a mailto link to the feedback address', () => {
    const url = feedbackUrl(ctx)
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?`)).toBe(true)
  })

  test('carries the version in the subject and the setup in the body', () => {
    const params = new URL(feedbackUrl(ctx)).searchParams
    expect(params.get('subject')).toBe('Panes feedback (0.1.0-alpha.24)')
    const body = params.get('body') ?? ''
    expect(body).toContain('Panes 0.1.0-alpha.24')
    expect(body).toContain('Chromium 140.0.1')
    expect(body).toContain('win32 x64 10.0.26300')
  })

  test('leaves room to write above the details', () => {
    const body = new URL(feedbackUrl(ctx)).searchParams.get('body') ?? ''
    expect(body.startsWith('\r\n\r\n\r\n')).toBe(true)
  })
})
