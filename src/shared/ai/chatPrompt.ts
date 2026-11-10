/**
 * How one chat turn is laid out for the model. The order is what makes a local model quick:
 *
 *   system: instructions (+ the tool definitions the template adds)   -- the same for every turn
 *   user:   the attached files and pages (their openings)              -- the same from one question to the next
 *   ...earlier turns...
 *   user:   board context, the open tabs, passages picked for this question, the question
 *
 * A model server keeps what it last read and reads again only from the first difference. With the pages up front, a
 * follow-up about the same page reads just the new question, and the panel can have the server read the pages ahead
 * of time (prime) while the person is still typing.
 */

import { wrapDoc } from './docs'
import { wrapPage } from './chatTools'
import { cutPage } from './passages'

export interface PromptPage {
  tabId: number
  title: string
  url: string
  /** The whole readable text (it is cut here). */
  text: string
  /** A PDF open in the tab: its page count. */
  pdf?: { pages: number; cut: boolean }
}

export interface PromptInput {
  /** chatSystem(...) */
  system: string
  /** Attached files, already wrapped and cut. */
  docs: string
  pages: PromptPage[]
  /** Characters all pages share (openings and passages together). */
  pageCap: number
  /** The canvas board's description, if any. */
  context?: string
  /** tabsBlock(...) */
  tabs?: string
  /** The question as typed ('' when priming). */
  typed: string
}

export interface PromptOut {
  system: string
  /**
   * The attached files and pages, as a user message of their own before the earlier turns ('' when none). Not in the
   * system message: chat templates put the tool definitions after the system text, so a new page there would make
   * the server read the tools again too.
   */
  attached: string
  /** The last user message. */
  last: string
}

/** The messages for a turn, in the order the server can keep cached. */
export const promptMessages = <T>(
  p: PromptOut,
  prior: T[]
): Array<T | { role: 'user'; content: string }> => [
  ...(p.attached ? [{ role: 'user' as const, content: p.attached }] : []),
  ...prior,
  { role: 'user' as const, content: p.last }
]

const NO_CAP = Number.MAX_SAFE_INTEGER

export function assemblePrompt(i: PromptInput): PromptOut {
  const cap = i.pages.length ? Math.floor(i.pageCap / i.pages.length) : 0
  const stable: string[] = []
  const picked: string[] = []
  for (const p of i.pages) {
    const c = cutPage(p.text, i.typed, cap)
    const name = `${p.title || p.url} (tab ${p.tabId}, ${p.url})`
    stable.push(
      p.pdf
        ? wrapDoc({ name, pages: p.pdf.pages, text: c.lead, cut: c.cut || p.pdf.cut }, NO_CAP)
        : wrapPage({ tabId: p.tabId, title: p.title, url: p.url, text: c.lead }, NO_CAP) +
            (c.cut
              ? '\n(Longer page: passages from further down that match the question are in the message.)'
              : '')
    )
    // a prime has no question yet: the passages are picked when it comes
    if (c.extra && i.typed)
      picked.push(
        wrapPage(
          { tabId: p.tabId, title: `${p.title} (further down)`, url: p.url, text: c.extra },
          NO_CAP
        )
      )
  }
  const attached = [i.docs, ...stable].filter(Boolean).join('\n\n')
  return {
    system: i.system,
    attached: attached ? `Attached for this conversation:\n${attached}` : '',
    last: [
      i.context?.trim() ? `<context>\n${i.context.trim()}\n</context>` : '',
      i.tabs ?? '',
      ...picked,
      i.typed
    ]
      .filter(Boolean)
      .join('\n\n')
  }
}
