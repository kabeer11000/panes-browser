/** Where feedback from the browser goes. */
export const FEEDBACK_EMAIL = 'kabeer11000@gmail.com'

export interface FeedbackContext {
  version: string
  chrome: string
  platform: string
  arch: string
  /** The operating system's own release string, e.g. "10.0.26300". */
  os: string
}

/** A mailto: link that opens the person's email app with a message ready to write, and what is needed to look into it. */
export function feedbackUrl(c: FeedbackContext): string {
  const subject = `Panes feedback (${c.version})`
  const body = [
    '',
    '',
    '',
    '-- Write above this line. This helps me look into it:',
    `Panes ${c.version}`,
    `Chromium ${c.chrome}`,
    `${c.platform} ${c.arch} ${c.os}`
  ].join('\r\n')
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
