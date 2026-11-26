import { useEffect, useRef, useState } from 'react'
import { tabFrameSize } from '@shared/capture'
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
      v.removeAttribute('style') // measured as its stylesheet places it, not as the last tab's stream was placed
      const box = v.getBoundingClientRect()
      // exactly the page's own size, drawn where main put the page (its slot rounded to whole px) and as big as the
      // page draws itself: black bars along an edge otherwise, or a page that shifts a hair as it swaps (tabFrameSize)
      const { frame, box: size } = tabFrameSize(box.width, box.height, window.devicePixelRatio || 1)
      Object.assign(v.style, {
        left: `${Math.round(box.left) - box.left}px`,
        top: `${Math.round(box.top) - box.top}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
        objectFit: 'fill'
      })
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: source,
            maxWidth: frame.width,
            maxHeight: frame.height,
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
