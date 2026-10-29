import { app, shell } from 'electron'
import { release } from 'os'
import { feedbackUrl, feedbackWebUrl, type FeedbackContext } from '../shared/feedback'

/**
 * Open the person's email app with a message to the developer, ready to write. Where the system has no email app to
 * hand the link to, the same message opens as a web page instead (`openWeb` shows it in a tab).
 */
export function sendFeedback(openWeb: (url: string) => void): void {
  const c: FeedbackContext = {
    version: app.getVersion(),
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    os: release()
  }
  shell.openExternal(feedbackUrl(c)).catch(() => openWeb(feedbackWebUrl(c)))
}
