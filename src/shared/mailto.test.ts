import { describe, expect, test } from 'bun:test'
import { mailtoWebUrl } from './mailto'

const link = 'mailto:a@b.co?subject=Hi%20there&body=Line%201%0D%0ALine%202&cc=c@d.co'

describe('mailtoWebUrl', () => {
  test('fills a Gmail compose page from the link', () => {
    const url = new URL(mailtoWebUrl(link, 'gmail') ?? '')
    expect(url.hostname).toBe('mail.google.com')
    expect(url.searchParams.get('to')).toBe('a@b.co')
    expect(url.searchParams.get('su')).toBe('Hi there')
    expect(url.searchParams.get('body')).toBe('Line 1\r\nLine 2')
    expect(url.searchParams.get('cc')).toBe('c@d.co')
  })

  test('Outlook and Yahoo name their fields their own way', () => {
    const o = new URL(mailtoWebUrl(link, 'outlook') ?? '')
    expect(o.searchParams.get('subject')).toBe('Hi there')
    const y = new URL(mailtoWebUrl(link, 'yahoo') ?? '')
    expect(y.searchParams.get('subj')).toBe('Hi there')
  })

  test('a plain address works, and something that is not a mailto link gives nothing', () => {
    expect(new URL(mailtoWebUrl('mailto:x@y.z', 'gmail') ?? '').searchParams.get('to')).toBe(
      'x@y.z'
    )
    expect(mailtoWebUrl('https://example.com', 'gmail')).toBeNull()
    expect(mailtoWebUrl('not a url', 'gmail')).toBeNull()
  })
})
