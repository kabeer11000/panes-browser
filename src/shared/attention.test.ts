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
  MAX_MESSAGES,
  messageAge,
  nudge,
  nudgeText,
  worthPeek,
  accountKey,
  groupWaiting,
  PEEK_QUIET_MS,
  type Nudge,
  type TabMessage,
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

/** A notification with just a title. */
const n = (title: string): { title: string; body: string } => ({ title, body: '' })

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
    expect(tabAttention(m, facts(), 0)).toEqual({
      count: 2,
      unseen: true,
      call: null,
      messages: []
    })
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
    expect(tabAttention(m, facts(), 0)).toEqual({
      count: 4,
      unseen: true,
      call: null,
      messages: []
    })
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
    let m = noteNotification(FRESH_MEMO, n('Ana: hi'), false, 0)
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
    expect(noteNotification(FRESH_MEMO, n('Ana: hi'), false, 0).unseen).toBe(true)
    expect(noteNotification(FRESH_MEMO, n('Ana: hi'), true, 0)).toBe(FRESH_MEMO)
  })
  test('a call notification rings for a while, then stops', () => {
    const m = noteNotification(FRESH_MEMO, n('WhatsApp Incoming voice call'), false, 1000)
    expect(m.ringUntil).toBe(1000 + RING_MS)
    expect(callState(m, facts(), 1000)).toBe('ringing')
    expect(callState(m, facts(), 1000 + RING_MS)).toBeNull()
  })
  test('a message notification does not ring', () => {
    expect(noteNotification(FRESH_MEMO, n('Ana: hi'), false, 0).ringUntil).toBe(0)
  })
  test('keeps what it said, newest last, only the last few', () => {
    let m = FRESH_MEMO
    for (let i = 1; i <= MAX_MESSAGES + 2; i++) m = noteNotification(m, n(`m${i}`), false, i)
    expect(m.messages).toHaveLength(MAX_MESSAGES)
    expect(m.messages.at(-1)).toEqual({
      title: `m${MAX_MESSAGES + 2}`,
      body: '',
      at: MAX_MESSAGES + 2
    })
    expect(m.messages[0].title).toBe('m3')
    expect(tabAttention(m, facts(), 0).messages).toBe(m.messages)
  })
  test('the call words may be in the body alone', () => {
    const m = noteNotification(FRESH_MEMO, { title: 'Ana', body: 'is calling you' }, false, 0)
    expect(m.ringUntil).toBe(RING_MS)
  })
  test('looking keeps nothing', () => {
    expect(noteNotification(FRESH_MEMO, n('Ana: hi'), true, 0).messages).toEqual([])
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
    m = noteNotification(m, n('Incoming call'), false, 0)
    expect(m.messages).toHaveLength(1)
    const seen = noteSeen(m)
    expect(seen).toEqual({ seenCount: 2, count: 2, unseen: false, ringUntil: 0, messages: [] })
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

describe('messageAge', () => {
  test('short, coarsest unit that fits', () => {
    const m = 60_000
    expect(messageAge(0, 30_000)).toBe('now')
    expect(messageAge(0, -5)).toBe('now') // a clock that stepped back
    expect(messageAge(0, 4 * m)).toBe('4m')
    expect(messageAge(0, 59 * m)).toBe('59m')
    expect(messageAge(0, 60 * m)).toBe('1h')
    expect(messageAge(0, 24 * 60 * m)).toBe('1d')
  })
})

describe('nudge', () => {
  const at = (p: Partial<TabAttention>): TabAttention => ({ ...NO_ATTENTION, ...p })
  const msg = (title: string, when: number): TabMessage => ({ title, body: '', at: when })
  test('nothing new, nothing said', () => {
    expect(nudge(NO_ATTENTION, NO_ATTENTION)).toBeNull()
    expect(nudge(at({ count: 3 }), at({ count: 3 }))).toBeNull()
    expect(nudge(at({ count: 3 }), at({ count: 2 }))).toBeNull()
    expect(nudge(at({ call: 'ringing' }), at({ call: 'ringing' }))).toBeNull()
    expect(nudge(at({ call: null }), at({ call: 'live' }))).toBeNull()
  })
  test('a title count going up', () => {
    expect(nudge(at({ count: 1 }), at({ count: 2, unseen: true }))).toEqual({
      kind: 'count',
      count: 2
    })
  })
  test('a flash with no count', () => {
    expect(nudge(NO_ATTENTION, at({ unseen: true }))).toEqual({ kind: 'activity' })
  })
  test('a notification wins over the count it came with; a call over everything', () => {
    const m = msg('Ana', 5)
    expect(nudge(NO_ATTENTION, at({ count: 1, unseen: true, messages: [m] }))).toEqual({
      kind: 'message',
      msg: m
    })
    expect(nudge(NO_ATTENTION, at({ count: 1, call: 'ringing', messages: [m] }))).toEqual({
      kind: 'call'
    })
  })
  test('another notification after one already seen in the list', () => {
    const a = msg('Ana', 1)
    const b = msg('Bo', 2)
    expect(nudge(at({ messages: [a] }), at({ messages: [a, b] }))).toEqual({
      kind: 'message',
      msg: b
    })
  })
  test('in words', () => {
    expect(nudgeText({ kind: 'call' })).toBe('Call coming in')
    expect(nudgeText({ kind: 'message', msg: { title: 'Ana', body: 'hi', at: 0 } })).toBe('Ana: hi')
    expect(nudgeText({ kind: 'message', msg: { title: '', body: '', at: 0 } })).toBe('New message')
    expect(nudgeText({ kind: 'count', count: 4 })).toBe('4 unread')
    expect(nudgeText({ kind: 'activity' })).toBe('New activity')
  })
})

describe('worthPeek', () => {
  const count = (c: number): Nudge => ({ kind: 'count', count: c })
  test('calls and notifications always; guesses never', () => {
    const last = { count: 9, at: 0 }
    expect(worthPeek({ kind: 'call' }, last, 1)).toBe(true)
    expect(worthPeek({ kind: 'message', msg: { title: 'a', body: '', at: 1 } }, last, 1)).toBe(true)
    expect(worthPeek({ kind: 'activity' }, undefined, 1)).toBe(false)
  })
  test('a count once, then again only higher or after a quiet while', () => {
    expect(worthPeek(count(1), undefined, 0)).toBe(true)
    expect(worthPeek(count(1), { count: 1, at: 0 }, 5_000)).toBe(false) // the title flashed back
    expect(worthPeek(count(2), { count: 1, at: 0 }, 5_000)).toBe(true)
    expect(worthPeek(count(1), { count: 1, at: 0 }, PEEK_QUIET_MS + 1)).toBe(true)
  })
})

describe('accountKey', () => {
  test('the site, without www', () => {
    expect(accountKey('https://www.youtube.com/watch?v=1')).toBe('youtube.com')
    expect(accountKey('https://youtube.com/')).toBe('youtube.com')
    expect(accountKey('https://www.instagram.com/direct/inbox/')).toBe('instagram.com')
  })
  test('account slots in the address keep accounts apart', () => {
    expect(accountKey('https://mail.google.com/mail/u/0/#inbox')).toBe('mail.google.com#0')
    expect(accountKey('https://mail.google.com/mail/u/1/#inbox')).toBe('mail.google.com#1')
    expect(accountKey('https://www.youtube.com/?authuser=2')).toBe('youtube.com#2')
    expect(accountKey('https://app.slack.com/client/T0123/C9')).toBe('app.slack.com#T0123')
  })
  test('a profile path is not an account slot', () => {
    expect(accountKey('https://www.reddit.com/u/someone')).toBe('reddit.com')
  })
  test('not an address: itself', () => {
    expect(accountKey('nonsense')).toBe('nonsense')
  })
})

describe('groupWaiting', () => {
  const tab = (
    id: number,
    url: string,
    a: Partial<TabAttention>
  ): { id: number; url: string; attention: TabAttention } => ({
    id,
    url,
    attention: { ...NO_ATTENTION, ...a }
  })
  test('tabs of one site are one entry, with the highest count, opening the busiest tab', () => {
    const g = groupWaiting([
      tab(1, 'https://www.youtube.com/watch?v=a', { unseen: true }),
      tab(2, 'https://www.youtube.com/', { count: 3, unseen: true }),
      tab(3, 'https://www.instagram.com/', { count: 1 })
    ])
    expect(g.map((x) => [x.key, x.id, x.tabs, x.attention.count])).toEqual([
      ['youtube.com', 2, [1, 2], 3],
      ['instagram.com', 3, [3], 1]
    ])
    expect(g[0].attention.unseen).toBe(true)
  })
  test('two accounts of one site stay apart', () => {
    const g = groupWaiting([
      tab(1, 'https://mail.google.com/mail/u/0/', { count: 2 }),
      tab(2, 'https://mail.google.com/mail/u/1/', { count: 5 })
    ])
    expect(g).toHaveLength(2)
  })
  test('a ringing call is the tab to open, and rings for the whole entry', () => {
    const g = groupWaiting([
      tab(1, 'https://web.whatsapp.com/', { count: 9 }),
      tab(2, 'https://web.whatsapp.com/', { call: 'ringing' })
    ])
    expect(g[0].id).toBe(2)
    expect(g[0].attention.call).toBe('ringing')
    expect(g[0].attention.count).toBe(9)
  })
  test('the same notification from two tabs is said once; different ones are kept in order', () => {
    const m = (title: string, at: number): TabMessage => ({ title, body: '', at })
    const g = groupWaiting([
      tab(1, 'https://x.com/', { messages: [m('Ana', 100), m('Bo', 300)] }),
      tab(2, 'https://x.com/', { messages: [m('Ana', 150)] })
    ])
    expect(g[0].attention.messages.map((x) => x.title)).toEqual(['Ana', 'Bo'])
  })
})
