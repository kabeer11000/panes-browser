import type { ChatPart } from '@shared/ai/chatConv'

/** What the assistant is doing right now, in a few words, from its last step. */
export function workingLabel(parts: readonly ChatPart[]): string {
  const last = [...parts].reverse().find((p) => p.type === 'tool')
  if (!last || last.type !== 'tool' || last.state !== 'running')
    return last ? 'Thinking it over' : 'Thinking'
  const d = last.detail
  switch (last.name) {
    case 'read_tab':
    case 'read_download':
    case 'read_web_page':
      return d ? `Reading ${d}` : 'Reading'
    case 'search_web':
      return 'Searching the web'
    case 'search_history':
      return 'Looking through your history'
    case 'list_downloads':
      return 'Looking at your downloads'
    case 'list_tabs':
      return 'Looking at your tabs'
    case 'look_at_page':
      return 'Looking at the page'
    case 'click':
      return 'Clicking'
    case 'type_text':
      return 'Typing'
    case 'navigate':
      return 'Opening the page'
    case 'scroll_page':
      return 'Scrolling'
    default:
      return 'Working'
  }
}
