import { attentionLabel, type CallState } from '../../../shared/attention'
import { PhoneIcon } from './icons'

/**
 * A call coming in to a tab. Only ringing: once the call is live the page holds the microphone, and the capture
 * badge beside this one already says so.
 */
export function CallBadge({ call }: { call: CallState | null }): React.JSX.Element | null {
  if (call !== 'ringing') return null
  const said = attentionLabel({ count: 0, unseen: false, call })
  return (
    <span className="call-badge" title={said} role="img" aria-label={said}>
      <PhoneIcon />
    </span>
  )
}
