import { useEffect, useRef, useState } from 'react'
/**
 * A page live under something drawn over it (the preview's popovers, the tab view's search): main parks the page out
 * of sight, still painting, and it is streamed here over its picture, so a video plays on and the page moves as it
 * does. Hidden (`on` unset) until its first frame is in: the picture under it shows until then.
 */
export function TabStream({
  tab,
  className
}: {
  tab: number
  className: string
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const v = video.current
    if (!v) return
    let dead = false
    let stream: MediaStream | null = null
    void (async () => {
      const source = await window.api.canvas.streamSource?.(tab)
      if (!source || dead) return
      const d = window.devicePixelRatio || 1
      const box = v.getBoundingClientRect()
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: source,
            maxWidth: Math.round(box.width * d),
            maxHeight: Math.round(box.height * d),
            maxFrameRate: 30
          }
        }
      } as unknown as MediaStreamConstraints)
      if (dead) return s.getTracks().forEach((t) => t.stop())
      stream = s
      v.srcObject = s
      void v.play().catch(() => undefined)
    })().catch(() => undefined)
    return () => {
      dead = true
      stream?.getTracks().forEach((t) => t.stop())
      v.srcObject = null
    }
  }, [tab])
  return (
    <video
      ref={video}
      className={className + (shown ? ' on' : '')}
      muted
      playsInline
      onLoadedData={() => setShown(true)}
    />
  )
}
