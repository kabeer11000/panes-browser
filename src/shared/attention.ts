import { type CaptureState } from './capture'

/**
 * Whether a tab needs the person: new messages, a call ringing or under way. Worked out in main from what the page
 * shows anyway (its title, its icon, the notifications it sends, what it captures), never by reading the page.
 */

/** A call coming in (it rings until answered, declined or given up on) or one the person is in. */
export type CallState = 'ringing' | 'live'

export interface TabAttention {
  /** The site's own unread count, from its title, while it is higher than when the person last looked; else 0. */
  count: number
  /** Something new arrived while the person was not looking (a notification, a new count, a flashing title). */
  unseen: boolean
  call: CallState | null
}

export const NO_ATTENTION: TabAttention = { count: 0, unseen: false, call: null }

/** What main remembers per tab between events, to tell what is new since the person last looked. */
export interface AttentionMemo {
  /** The title's count when the person last looked (or lower, if it fell since). */
  seenCount: number
  /** The title's count now; 0 when the title shows none. */
  count: number
  unseen: boolean
  /** A notification said a call is coming in: it counts as ringing until then (ms since epoch). */
  ringUntil: number
}

export const FRESH_MEMO: AttentionMemo = { seenCount: 0, count: 0, unseen: false, ringUntil: 0 }

/** How long a call announced by a notification counts as ringing; calls give up ringing after about this long. */
export const RING_MS = 45_000

/**
 * The unread count a title carries, or 0. Covers the usual ways sites put it: "(3) WhatsApp", "(99+) Discord",
 * "[2] Chat", "Inbox (12) - me@gmail.com - Gmail", "3 unread messages".
 */
export function titleCount(title: string): number {
  const m =
    /^\s*[([](\d{1,5})\+?[)\]]/.exec(title) ?? // leading (3), (99+) or [2]
    /\b(?:inbox|chat|mail|messages?|notifications?)\s*\((\d{1,5})\+?\)/i.exec(title) ?? // Inbox (12)
    /\b(\d{1,5})\+?\s+(?:unread|new)\b/i.exec(title) // 3 unread, 2 new
  return m ? Number(m[1]) : 0
}

/** Words of a call coming in, in a title or a notification: "Incoming voice call", "Ana is calling you". */
const CALL_TEXT =
  /\b(incoming (?:voice |video |audio )?call|is calling(?: you)?|calling you|wants to (?:video )?call|invited you to (?:a |the )?huddle)\b/i

export function isCallText(text: string): boolean {
  return CALL_TEXT.test(text)
}

/** Words of a message arriving, as sites flash them in the title: "New message from Ana", "Ana says...". */
const MESSAGE_TEXT =
  /\b(new (?:message|messages|notification|mail|email|activity)|sent you a message|messaged you|mentioned you|replied to you|says:?)\b/i

/** Web apps people take calls in: in these, using the microphone or camera is a call even in a quiet moment. */
const CALL_HOSTS = [
  'web.whatsapp.com',
  'meet.google.com',
  'discord.com',
  'app.slack.com',
  'teams.microsoft.com',
  'teams.live.com',
  'zoom.us',
  'messenger.com',
  'web.telegram.org',
  'web.skype.com'
]

export function isCallSite(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return CALL_HOSTS.some((h) => host === h || host.endsWith('.' + h))
}

/** The page's title changed. `looking`: the person has the tab in front of them right now. */
export function noteTitle(memo: AttentionMemo, title: string, looking: boolean): AttentionMemo {
  const count = titleCount(title)
  if (looking) return { ...memo, count, seenCount: count, unseen: false }
  // The site says everything is read (on the phone, say): nothing is waiting any more.
  if (count === 0 && memo.count > 0) return { ...memo, count, seenCount: 0, unseen: false }
  const seenCount = Math.min(memo.seenCount, count) // a count that fell and rose again is new again
  const rose = count > memo.count && count > seenCount
  return { ...memo, count, seenCount, unseen: memo.unseen || rose || MESSAGE_TEXT.test(title) }
}

/** The page sent a notification (title and body joined). */
export function noteNotification(
  memo: AttentionMemo,
  text: string,
  looking: boolean,
  now: number
): AttentionMemo {
  if (looking) return memo
  return { ...memo, unseen: true, ringUntil: isCallText(text) ? now + RING_MS : memo.ringUntil }
}

/**
 * The page swapped its icon for another (Gmail, Outlook and Discord draw their badge into it). Only for a page that
 * shows no count in its title: where it does, the title already said what changed. ponytail: any swap counts, so a
 * site that animates its icon would look busy; tell swaps apart by image if one turns up.
 */
export function noteFavicon(memo: AttentionMemo, looking: boolean): AttentionMemo {
  if (looking || memo.count > 0) return memo
  return { ...memo, unseen: true }
}

/** The person is looking at the tab: whatever was waiting has been seen. */
export function noteSeen(memo: AttentionMemo): AttentionMemo {
  if (!memo.unseen && memo.seenCount === memo.count && memo.ringUntil === 0) return memo
  return { ...memo, seenCount: memo.count, unseen: false, ringUntil: 0 }
}

export interface CallFacts {
  url: string
  title: string
  capture: CaptureState
  /** Sound is playing in the tab (and not muted away: a muted call is still a call). */
  audible: boolean
}

/**
 * A call is live while the page holds the microphone or camera and either sound is coming back or it is a calling
 * app (a quiet moment in a call is still a call; dictation on some page with the speaker off is not). It is ringing
 * while the title says so or a recent notification did.
 */
export function callState(memo: AttentionMemo, f: CallFacts, now: number): CallState | null {
  if ((f.capture.mic || f.capture.camera) && (f.audible || isCallSite(f.url))) return 'live'
  if (isCallText(f.title) || now < memo.ringUntil) return 'ringing'
  return null
}

/** What the tab shows. */
export function tabAttention(memo: AttentionMemo, f: CallFacts, now: number): TabAttention {
  return {
    count: memo.count > memo.seenCount ? memo.count : 0,
    unseen: memo.unseen,
    call: callState(memo, f, now)
  }
}

export interface SpaceAttention {
  /** Unread counts of the space's tabs added up. */
  count: number
  /** Some tab in the space has something unseen (with or without a count). */
  unseen: boolean
  /** The most urgent call in the space: ringing outranks live. */
  call: CallState | null
  /** The tab with that call, so going to the space can land on it. */
  callTabId: number | null
}

/** Each space's tabs summed up, for the space avatars. Spaces with nothing are left out. */
export function spaceAttention(
  tabs: Iterable<{ id: number; spaceId: number; attention: TabAttention }>
): Record<number, SpaceAttention> {
  const out: Record<number, SpaceAttention> = {}
  for (const { id, spaceId, attention: a } of tabs) {
    if (!a.unseen && a.count === 0 && !a.call) continue
    const s = (out[spaceId] ??= { count: 0, unseen: false, call: null, callTabId: null })
    s.count += a.count
    s.unseen ||= a.unseen || a.count > 0
    if (a.call && (s.call === null || (s.call === 'live' && a.call === 'ringing'))) {
      s.call = a.call
      s.callTabId = id
    }
  }
  return out
}

/** In words, for tooltips and screen readers: "A call is coming in", "3 unread", "New activity", or ''. */
export function attentionLabel(a: Pick<TabAttention, 'count' | 'unseen' | 'call'>): string {
  if (a.call === 'ringing') return 'A call is coming in'
  if (a.call === 'live') return 'In a call'
  if (a.count > 0) return `${a.count} unread`
  return a.unseen ? 'New activity' : ''
}

/** A count as a badge shows it: small numbers as they are, anything larger as 99+. */
export function badgeText(count: number): string {
  return count > 99 ? '99+' : count > 0 ? String(count) : ''
}

/** The whole window summed up, for its taskbar button. */
export function windowAttention(spaces: Record<number, SpaceAttention>): {
  count: number
  unseen: boolean
  ringing: boolean
} {
  let count = 0
  let unseen = false
  let ringing = false
  for (const s of Object.values(spaces)) {
    count += s.count
    unseen ||= s.unseen
    ringing ||= s.call === 'ringing'
  }
  return { count, unseen, ringing }
}
