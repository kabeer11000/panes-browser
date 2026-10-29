/** What opens a mailto: link: the system's email app, or the compose page of a web mail service. */
export type MailHandler = 'system' | 'gmail' | 'outlook' | 'yahoo'

export const MAIL_HANDLERS: Array<{ value: MailHandler; label: string }> = [
  { value: 'system', label: 'Email app' },
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook' },
  { value: 'yahoo', label: 'Yahoo' }
]

/** The compose page of a web mail service with the message of a mailto: link filled in; null if it is not a mailto: link. */
export function mailtoWebUrl(
  mailto: string,
  handler: Exclude<MailHandler, 'system'>
): string | null {
  let u: URL
  try {
    u = new URL(mailto)
  } catch {
    return null
  }
  if (u.protocol !== 'mailto:') return null
  const to = decodeURIComponent(u.pathname)
  const q = (k: string): string => u.searchParams.get(k) ?? ''
  const e = encodeURIComponent
  if (handler === 'gmail') {
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${e(to)}&cc=${e(q('cc'))}&bcc=${e(q('bcc'))}&su=${e(q('subject'))}&body=${e(q('body'))}`
  }
  if (handler === 'outlook') {
    return `https://outlook.live.com/mail/0/deeplink/compose?to=${e(to)}&cc=${e(q('cc'))}&bcc=${e(q('bcc'))}&subject=${e(q('subject'))}&body=${e(q('body'))}`
  }
  return `https://compose.mail.yahoo.com/?to=${e(to)}&cc=${e(q('cc'))}&bcc=${e(q('bcc'))}&subj=${e(q('subject'))}&body=${e(q('body'))}`
}
