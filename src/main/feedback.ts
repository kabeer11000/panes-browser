import { app } from 'electron'
import { release } from 'os'
import { feedbackUrl } from '../shared/feedback'

/** The mailto: link for a message to the developer, with this version and system in it. */
export function feedbackMailto(): string {
  return feedbackUrl({
    version: app.getVersion(),
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    os: release()
  })
}
