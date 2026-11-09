import { useRef, useEffect, useState } from 'react'
import type { StepGroup } from '@shared/ai/chatConv'
import { ChevronIcon } from '../icons'

const CONFIRM_LABEL: Record<string, string> = {
  close_tabs: 'Close tabs',
  click: 'Click it',
  type_text: 'Submit'
}

/** A tool call waiting for the person: nothing runs until Confirm. Cancel has focus, so a stray Enter is safe. */
export function ConfirmCard({
  group,
  onAnswer
}: {
  group: StepGroup
  onAnswer: (callId: string, ok: boolean) => void
}): React.JSX.Element {
  const step = group.steps[0]
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => cancel.current?.focus(), [])
  return (
    <div className="chat-confirm" role="group" aria-label="Confirm this action">
      <p>{step.detail}</p>
      <div className="chat-confirm-actions">
        <button
          ref={cancel}
          type="button"
          className="chat-btn"
          onClick={() => onAnswer(step.id, false)}
        >
          Cancel
        </button>
        <button type="button" className="chat-btn danger" onClick={() => onAnswer(step.id, true)}>
          {CONFIRM_LABEL[step.name] ?? 'Confirm'}
        </button>
      </div>
    </div>
  )
}

/** A row such as "Read 3 tabs": one line with its state, and the details a click away. */
export function StepRow({ group }: { group: StepGroup }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const details = group.steps.map((s) => s.detail).filter(Boolean)
  return (
    <div className={'chat-step ' + group.state}>
      <button
        type="button"
        className="chat-step-head"
        aria-expanded={open}
        disabled={details.length === 0}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="chat-step-mark" aria-hidden="true" />
        <span className="chat-step-label">{group.label}</span>
        {details.length > 0 && (
          <span className={'chat-step-chev' + (open ? ' open' : '')} aria-hidden="true">
            <ChevronIcon />
          </span>
        )}
      </button>
      {open && (
        <ul className="chat-step-details">
          {details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
