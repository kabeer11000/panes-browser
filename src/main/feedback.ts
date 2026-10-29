import { app, shell } from 'electron'
import { release } from 'os'
import { feedbackUrl } from '../shared/feedback'

/** Open the person's email app with a message to the developer, ready to write. */
export function sendFeedback(): void {
  void shell.openExternal(
    feedbackUrl({
      version: app.getVersion(),
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
      os: release()
    })
  )
}
