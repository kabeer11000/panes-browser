import { describe, expect, test } from 'bun:test'
import {
  attentionLabel,
  badgeText,
  callState,
  FRESH_MEMO,
  isCallSite,
  isCallText,
  NO_ATTENTION,
  noteFavicon,
  noteNotification,
  noteSeen,
  noteTitle,
  RING_MS,
  spaceAttention,
  tabAttention,
  titleCount,
  windowAttention,
  type AttentionMemo,
  type CallFacts,
  type TabAttention
} from './attention'
import { NO_CAPTURE } from './capture'

describe('titleCount', () => {
  test('the usual places sites put a count', () => {
    expect(titleCount('(3) WhatsApp')).toBe(3)
    expect(titleCount('(99+) Discord | #general')).toBe(99)
    expect(titleCount('[2] Chat')).toBe(2)
    expect(titleCount('  (7) Messenger')).toBe(7)
    expect(titleCount('Inbox (12) - me@gmail.com - Gmail')).toBe(12)
    expect(titleCount('Chat (4) - Google Chat')).toBe(4)
    expect(titleCount('3 unread messages')).toBe(3)
    expect(titleCount('5 new - Feed')).toBe(5)
  })
  test('numbers that are not counts', () => {
    expect(titleCount('WhatsApp')).toBe(0)
    expect(titleCount('')).toBe(0)
    expect(titleCount('Top 10 films of 2024')).toBe(0)
    expect(titleCount('Episode (2) recap')).toBe(0)
    expect(titleCount('iPhone 15 (2023) review')).toBe(0)
    expect(titleCount('Inbox - Gmail')).toBe(0)
  })
})

describe('call words and sites', () => {
  test('call text', () => {
    expect(isCallText('Incoming voice call')).toBe(true)
    expect(isCallText('Incoming video call from Ana')).toBe(true)
    expect(isCallText('Ana is calling you')).toBe(true)
    expect(isCallText('Ana invited you to a huddle')).toBe(true)
    expect(isCallText('Ana: call me later')).toBe(false)
    expect(isCallText('Recalling the past')).toBe(false)
  })
  test('call sites, subdomains included, look-alikes not', () => {
    expect(isCallSite('https://web.whatsapp.com/')).toBe(true)
    expect(isCallSite('https://meet.google.com/abc-defg-hij')).toBe(true)
    expect(isCallSite('https://us02web.zoom.us/wc/123')).toBe(true)
    expect(isCallSite('https://discord.com/channels/1/2')).toBe(true)
    expect(isCallSite('https://notdiscord.com/')).toBe(false)
    expect(isCallSite('https://example.com/')).toBe(false)
    expect(isCallSite('not a url')).toBe(false)
  })
})

const facts = (p: Partial<CallFacts> = {}): CallFacts => ({
  url: 'https://example.com/',
  title: '',
  capture: NO_CAPTURE,
  audible: false,
  ...p
})

describe('noteTitle', () => {
  test('a count that rises out of sight is new', () => {
    const m = noteTitle(FRESH_MEMO, '(2) WhatsApp', false)
    expect(m).toMatchObject({ count: 2, seenCount: 0, unseen: true })
    expect(tabAttention(m, facts(), 0)).toEqual({ count: 2, unseen: true, call: null })
  })
  test('in front of the person, a count is seen as it changes', () => {
    const m = noteTitle(FRESH_MEMO, '(2) WhatsApp', true)
    expect(m).toMatchObject({ count: 2, seenCount: 2, unseen: false })
    expect(tabAttention(m, facts(), 0)).toEqual(NO_ATTENTION)
  })
  test('unread that was already seen does not nag; only a rise does', () => {
    let m = noteTitle(FRESH_MEMO, '(3) WhatsApp', true)
    m = noteTitle(m, '(3) WhatsApp', false)
    expect(tabAttention(m, facts(), 0)).toEqual(NO_ATTENTION)
    m = noteTitle(m, '(4) WhatsApp', false)
    expect(tabAttention(m, facts(), 0)).toEqual({ count: 4, unseen: true, call: null })
  })
  test('a count that falls and rises again is new again', () => {
    let m = noteTitle(FRESH_MEMO, '(3) WhatsApp', true)
    m = noteTitle(m, '(1) WhatsApp', false) // read on the phone
    expect(m.unseen).toBe(false)
    expect(m.seenCount).toBe(1)
    m = noteTitle(m, '(2) WhatsApp', false)
    expect(m.unseen).toBe(true)
  })
  test('a count dropping to nothing clears what was waiting', () => {
    let m = noteNotification(FRESH_MEMO, 'Ana: hi', false, 0)
    m = noteTitle(m, '(1) WhatsApp', false)
    m = noteTitle(m, 'WhatsApp', false)
    expect(tabAttention(m, facts(), 0)).toEqual(NO_ATTENTION)
  })
  test('a title flashing a message is new, an ordinary title change is not', () => {
    expect(noteTitle(FRESH_MEMO, 'New message from Ana', false).unseen).toBe(true)
    expect(noteTitle(FRESH_MEMO, 'Ana says: hi', false).unseen).toBe(true)
    expect(noteTitle(FRESH_MEMO, 'Some article - Site', false).unseen).toBe(false)
    expect(noteTitle(FRESH_MEMO, 'New message from Ana', true).unseen).toBe(false)
  })
  test('unseen stays until seen, whatever the title does next', () => {
    let m = noteTitle(FRESH_MEMO, 'New message from Ana', false)
    m = noteTitle(m, 'Chat', false)
    expect(m.unseen).toBe(true)
    expect(noteSeen(m).unseen).toBe(false)
  })
})

describe('noteNotification', () => {
  test('marks the tab only when the person is not looking', () => {
    expect(noteNotification(FRESH_MEMO, 'Ana: hi', false, 0).unseen).toBe(true)
    expect(noteNotification(FRESH_MEMO, 'Ana: hi', true, 0)).toBe(FRESH_MEMO)
  })
  test('a call notification rings for a while, then stops', () => {
    const m = noteNotification(FRESH_MEMO, 'WhatsApp Incoming voice call', false, 1000)
    expect(m.ringUntil).toBe(1000 + RING_MS)
    expect(callState(m, facts(), 1000)).toBe('ringing')
    expect(callState(m, facts(), 1000 + RING_MS)).toBeNull()
  })
  test('a message notification does not ring', () => {
    expect(noteNotification(FRESH_MEMO, 'Ana: hi', false, 0).ringUntil).toBe(0)
  })
})

describe('noteFavicon', () => {
  test('a new icon out of sight is new, unless the title carries a count', () => {
    expect(noteFavicon(FRESH_MEMO, false).unseen).toBe(true)
    expect(noteFavicon(FRESH_MEMO, true).unseen).toBe(false)
    const counted = noteTitle(FRESH_MEMO, '(2) Chat', true)
    expect(noteFavicon(counted, false).unseen).toBe(false)
  })
})

describe('noteSeen', () => {
  test('clears unseen, count and ringing, and keeps the same object when nothing changed', () => {
    let m: AttentionMemo = noteTitle(FRESH_MEMO, '(2) Chat', false)
    m = noteNotification(m, 'Incoming call', false, 0)
    const seen = noteSeen(m)
    expect(seen).toEqual({ seenCount: 2, count: 2, unseen: false, ringUntil: 0 })
    expect(noteSeen(seen)).toBe(seen)
  })
})

describe('callState', () => {
  test('microphone or camera with sound coming back is a live call anywhere', () => {
    expect(
      callState(FRESH_MEMO, facts({ capture: { ...NO_CAPTURE, mic: true }, audible: true }), 0)
    ).toBe('live')
    expect(
      callState(FRESH_MEMO, facts({ capture: { ...NO_CAPTURE, camera: true }, audible: true }), 0)
    ).toBe('live')
  })
  test('in a calling app, a quiet moment is still a live call', () => {
    const f = facts({ url: 'https://meet.google.com/x', capture: { ...NO_CAPTURE, mic: true } })
    expect(callState(FRESH_MEMO, f, 0)).toBe('live')
  })
  test('the microphone alone on an ordinary page, or a shared screen, is not a call', () => {
    expect(callState(FRESH_MEMO, facts({ capture: { ...NO_CAPTURE, mic: true } }), 0)).toBeNull()
    expect(
      callState(FRESH_MEMO, facts({ capture: { ...NO_CAPTURE, screen: true }, audible: true }), 0)
    ).toBeNull()
  })
  test('a title saying a call is coming in rings; live wins over ringing', () => {
    expect(callState(FRESH_MEMO, facts({ title: 'Incoming call - Teams' }), 0)).toBe('ringing')
    const live = facts({
      title: 'Incoming call',
      capture: { ...NO_CAPTURE, mic: true },
      audible: true
    })
    expect(callState(FRESH_MEMO, live, 0)).toBe('live')
  })
})

describe('spaceAttention', () => {
  const at = (p: Partial<TabAttention>): TabAttention => ({ ...NO_ATTENTION, ...p })
  test('sums counts, keeps unseen, and leaves quiet spaces out', () => {
    const out = spaceAttention([
      { id: 1, spaceId: 1, attention: at({ count: 2, unseen: true }) },
      { id: 2, spaceId: 1, attention: at({ count: 3 }) },
      { id: 3, spaceId: 2, attention: NO_ATTENTION },
      { id: 4, spaceId: 3, attention: at({ unseen: true }) }
    ])
    expect(out).toEqual({
      1: { count: 5, unseen: true, call: null, callTabId: null },
      3: { count: 0, unseen: true, call: null, callTabId: null }
    })
  })
  test('a ringing call outranks a live one and names its tab', () => {
    const out = spaceAttention([
      { id: 1, spaceId: 1, attention: at({ call: 'live' }) },
      { id: 2, spaceId: 1, attention: at({ call: 'ringing' }) },
      { id: 3, spaceId: 1, attention: at({ call: 'live' }) }
    ])
    expect(out[1]).toEqual({ count: 0, unseen: false, call: 'ringing', callTabId: 2 })
  })
  test('the first live call is the one kept when none rings', () => {
    const out = spaceAttention([
      { id: 5, spaceId: 2, attention: at({ call: 'live' }) },
      { id: 6, spaceId: 2, attention: at({ call: 'live' }) }
    ])
    expect(out[2].callTabId).toBe(5)
  })
})

describe('attentionLabel and badgeText', () => {
  test('the most urgent thing is said', () => {
    expect(attentionLabel({ count: 3, unseen: true, call: 'ringing' })).toBe('A call is coming in')
    expect(attentionLabel({ count: 3, unseen: true, call: 'live' })).toBe('In a call')
    expect(attentionLabel({ count: 3, unseen: true, call: null })).toBe('3 unread')
    expect(attentionLabel({ count: 0, unseen: true, call: null })).toBe('New activity')
    expect(attentionLabel(NO_ATTENTION)).toBe('')
  })
  test('counts are capped for a badge', () => {
    expect(badgeText(0)).toBe('')
    expect(badgeText(7)).toBe('7')
    expect(badgeText(99)).toBe('99')
    expect(badgeText(100)).toBe('99+')
  })
})

describe('windowAttention', () => {
  test('adds up every space', () => {
    expect(windowAttention({})).toEqual({ count: 0, unseen: false, ringing: false })
    expect(
      windowAttention({
        1: { count: 2, unseen: true, call: 'live', callTabId: 1 },
        2: { count: 1, unseen: true, call: 'ringing', callTabId: 4 }
      })
    ).toEqual({ count: 3, unseen: true, ringing: true })
  })
})
