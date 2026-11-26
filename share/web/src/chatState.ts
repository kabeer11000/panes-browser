import { useState } from 'react'
import { unreadAfter, type ChatMessage } from '@shared/share/chat'

/** One chat for the page: its button and lip, its panel on the board or in a live view (Chat.tsx). */
export interface ChatState {
  open: boolean
  unread: number
  toggle: (on: boolean) => void
}

/** Whether the chat is out, and what came while it was not. */
export function useChat(messages: ChatMessage[], me: number): ChatState {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<string | null>(null)
  const last = messages.at(-1)?.id ?? null
  return {
    open,
    unread: open ? 0 : unreadAfter(messages, seen, me),
    toggle: (on) => {
      if (!on && open) setSeen(last)
      setOpen(on)
    }
  }
}
