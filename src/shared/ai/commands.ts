/**
 * Plain commands about the person's own tabs, carried out at once without a model: scrolling, the video, switching
 * tabs, finding words. A small local model gets these wrong about a quarter of the time (it says "Paused." without
 * pausing) and takes half a minute to read its prompt on a laptop CPU; a pattern takes no time and is exact.
 * Anything that is not clearly one of these returns null and goes to the model. See quickAction (sites.ts) for
 * opening sites and searches.
 */

import { POLITE, TAIL } from './sites'
import type { ToolInput } from './chatTools'
import { displayHost } from '../url'

export interface CommandTab {
  id: number
  title: string
  url: string
  active: boolean
  audible?: boolean
}

export interface Command {
  call: ToolInput
  /** What the panel says once it is done. */
  say: string
}

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/** The one tab `name` points at ("youtube", "my docs", "the github"), by title or site; null if none or several. */
export function tabNamed(name: string, tabs: readonly CommandTab[]): CommandTab | null {
  const want = words(name).filter((w) => !['my', 'the', 'tab', 'page', 'one', 'that'].includes(w))
  if (want.length === 0) return null
  const hits = tabs.filter((t) => {
    const hay = `${t.title} ${displayHost(t.url) ?? ''}`.toLowerCase()
    return want.every((w) => hay.includes(w))
  })
  return hits.length === 1 ? hits[0] : null
}

const current = (tabs: readonly CommandTab[]): CommandTab | null =>
  tabs.find((t) => t.active) ?? null

/** The tab a media command means: the one named, else the one playing sound, else the current one. */
function mediaTab(named: string | undefined, tabs: readonly CommandTab[]): CommandTab | null {
  if (named) return tabNamed(named, tabs)
  const playing = tabs.filter((t) => t.audible)
  if (playing.length === 1) return playing[0]
  return current(tabs)
}

const MEDIA_NOUN = '(?:video|music|song|track|audio|podcast|stream|sound)'
type MediaVerb = 'play' | 'pause' | 'mute' | 'unmute' | 'restart'
const SAY_MEDIA: Record<MediaVerb, string> = {
  play: 'Playing.',
  pause: 'Paused.',
  mute: 'Muted.',
  unmute: 'Unmuted.',
  restart: 'Started it over.'
}

export function quickCommand(raw: string, tabs: readonly CommandTab[]): Command | null {
  const t = raw.replace(/\s+/g, ' ').trim()
  if (!t || t.length > 120 || /\?$/.test(t)) return null
  const s = t.replace(POLITE, '').replace(TAIL, '').trim().toLowerCase()
  const here = current(tabs)
  let m: RegExpExecArray | null

  // "scroll down", "scroll up a bit", "scroll to the top", "go to the bottom of the page"
  if ((m = /^scroll(?: (down|up))?(?: a bit| a little| more| some)?$/.exec(s)) && here)
    return {
      call: { name: 'scroll_page', tabId: here.id, direction: m[1] === 'up' ? 'up' : 'down' },
      say: `Scrolled ${m[1] === 'up' ? 'up' : 'down'}.`
    }
  if (
    (m =
      /^(?:scroll|go|jump) (?:back )?(?:up |down )?to the (top|bottom)(?: of (?:the|this) page)?$/.exec(
        s
      )) &&
    here
  )
    return {
      call: { name: 'scroll_page', tabId: here.id, direction: m[1] as 'top' | 'bottom' },
      say: `Scrolled to the ${m[1]}.`
    }
  // "scroll to the comments", "jump to ai settings", "scroll down to the reviews section"
  if (
    (m =
      /^(?:scroll|jump)(?: down| up)? to (?:the )?(.{2,60}?)(?: section)?(?: on (?:this|the|my current) (?:page|tab))?$/.exec(
        s
      )) &&
    here
  )
    return {
      call: { name: 'scroll_to', tabId: here.id, target: m[1] },
      say: `Scrolled to “${m[1]}”.`
    }

  // "pause", "pause it", "pause the video", "mute the youtube video", "play the music on spotify"
  const VERBS = '(pause|play|resume|unpause|mute|unmute|restart)'
  const media =
    new RegExp(`^${VERBS}(?: it| this| that)?$`).exec(s) ??
    new RegExp(`^${VERBS} (?:the |this |my )?(?:(.{2,30}?) )?${MEDIA_NOUN}$`).exec(s) ??
    new RegExp(
      `^${VERBS} (?:the |this |my )?(?:${MEDIA_NOUN} )?(?:on|in) (?:the |my )?(.{2,30}?)(?: tab)?$`
    ).exec(s)
  if (media) {
    // a tab that was named but matches no single tab is the model's to sort out
    const tab = mediaTab(media[2], tabs)
    const verb = media[1]
    const action = verb === 'resume' || verb === 'unpause' ? 'play' : (verb as MediaVerb)
    if (tab)
      return {
        call: { name: 'media_control', tabId: tab.id, action, amount: 1 },
        say: SAY_MEDIA[action]
      }
  }
  // "skip 30 seconds", "skip ahead 10s", "go back 15 seconds", "rewind 10 seconds"
  m =
    /^(skip(?: ahead| forward)?|fast forward|forward|go back|rewind|skip back)(?: by)? (\d{1,4}) ?(s|sec|secs|seconds?|m|min|mins|minutes?)$/.exec(
      s
    )
  if (m) {
    const tab = mediaTab(undefined, tabs)
    const back = /back|rewind/.test(m[1])
    const secs = Number(m[2]) * (m[3].startsWith('m') ? 60 : 1)
    if (tab && secs > 0)
      return {
        call: { name: 'media_control', tabId: tab.id, action: 'skip', amount: back ? -secs : secs },
        say: `${back ? 'Went back' : 'Skipped'} ${m[2]} ${m[3].startsWith('m') ? 'minutes' : 'seconds'}.`
      }
  }

  // "go to my youtube tab", "switch to the github tab", "show me my docs tab"
  if (
    (m =
      /^(?:go|switch|change|take me|jump|show me|bring up)(?: back)? to (?:my |the )?(.{2,40}?) tab$/.exec(
        s
      ))
  ) {
    const tab = tabNamed(m[1], tabs)
    if (tab)
      return {
        call: { name: 'switch_to_tab', tabId: tab.id },
        say: `Switched to ${tab.title || displayHost(tab.url) || 'that tab'}.`
      }
  }

  // "find pricing on this page", "highlight “terms of use” on the page"
  if (
    (m =
      /^(?:find|highlight|search for|look for)(?: the word| the words| the phrase)? ["“']?(.{1,60}?)["”']? (?:on|in) (?:this|the|my current) (?:page|tab)$/.exec(
        s
      )) &&
    here
  )
    return {
      call: { name: 'find_in_page', tabId: here.id, text: m[1] },
      say: `Highlighted “${m[1]}”.`
    }
  return null
}
