import { isCapturing, type CaptureKind } from '@shared/capture'
import type { TabInfo } from '@shared/types'
import { CameraIcon, MicIcon, MicOffIcon, ScreenIcon } from './icons'

const hostOf = (url: string): string => {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

const KINDS: readonly CaptureKind[] = ['camera', 'mic', 'screen']

/** While any page is using the camera or microphone or sharing the screen: what, a way back to that tab, and a button that ends it. */
export function SharingBar({
  tabs,
  activeId
}: {
  tabs: TabInfo[]
  activeId: number | null
}): React.JSX.Element | null {
  const using = tabs.filter((t) => isCapturing(t.capture))
  if (using.length === 0) return null
  const tab = using.find((t) => t.id === activeId) ?? using[0]
  const kinds = KINDS.filter((k) => using.some((t) => t.capture[k]))
  // muted only when every tab holding the mic has it muted
  const micMuted = using.every((t) => !t.capture.mic || t.capture.micMuted)
  const devices = ['camera' as const, 'mic' as const]
    .filter((k) => kinds.includes(k))
    .map((k) => (k === 'camera' ? 'camera on' : micMuted ? 'mic muted' : 'mic on'))
  const text = (kinds.includes('screen') ? ['sharing screen', ...devices] : devices).join(', ')
  const label = text.charAt(0).toUpperCase() + text.slice(1)
  const stopLabel = kinds.every((k) => k === 'screen') ? 'Stop sharing' : 'Stop'
  return (
    <div className="sharing-bar" role="status">
      <button
        type="button"
        className="sharing-who"
        title={`${hostOf(tab.url)}${using.length > 1 ? ` and ${using.length - 1} more` : ''}: ${label.toLowerCase()}`}
        onClick={() => window.api.activateTab(tab.id)}
      >
        <span className="sharing-dot" />
        {kinds.includes('camera') && <CameraIcon />}
        {kinds.includes('mic') && (micMuted ? <MicOffIcon /> : <MicIcon />)}
        {kinds.includes('screen') && <ScreenIcon />}
        <span>{label}</span>
      </button>
      <button
        type="button"
        className="sharing-stop"
        onClick={() => using.forEach((t) => window.api.stopCapture(t.id, [...kinds]))}
      >
        {stopLabel}
      </button>
    </div>
  )
}
