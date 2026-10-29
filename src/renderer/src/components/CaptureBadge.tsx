import type { CaptureState } from '../../../shared/capture'
import { isCapturing } from '../../../shared/capture'
import { CameraIcon, MicIcon, ScreenIcon } from './icons'

/** Red marks on a tab whose page is using the camera, the microphone or sharing the screen. */
export function CaptureBadge({ capture }: { capture: CaptureState }): React.JSX.Element | null {
  if (!isCapturing(capture)) return null
  const what = [
    capture.camera && 'the camera',
    capture.mic && 'the microphone',
    capture.screen && 'your screen'
  ].filter(Boolean)
  return (
    <span
      className="capture-badge"
      title={`This page is using ${what.join(' and ')}`}
      role="img"
      aria-label={`Using ${what.join(' and ')}`}
    >
      {capture.camera && <CameraIcon />}
      {capture.mic && <MicIcon />}
      {capture.screen && <ScreenIcon />}
    </span>
  )
}
