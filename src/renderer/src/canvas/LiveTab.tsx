import { useEffect, useRef, useState } from 'react'
import { CARD_H, CARD_W } from '@shared/ai/canvas'
import {
  captureWidth,
  fitRegion,
  streamCap,
  streamFps,
  type VideoRegion
} from '@shared/ai/tabStream'

const FPS = streamFps(streamCap(navigator))
/** How often the video's place in the page is asked again (theatre mode, scrolling). */
const REGION_MS = 4000
const SIDES = ['x', 'y', 'w', 'h'] as const

function stop(s: MediaStream): void {
  for (const t of s.getTracks()) t.stop()
}

/**
 * A playing tab, live on its card: the tab's own page streamed (tab capture, video only, so the sound stays in the
 * tab and is never doubled), cropped to the video playing in it. A tab with no playing video in view is not
 * streamed: the card keeps its picture and its media controls.
 */
export function LiveTab({ id, cardPx }: { id: number; cardPx: number }): React.JSX.Element | null {
  const video = useRef<HTMLVideoElement>(null)
  const [region, setRegion] = useState<VideoRegion | null>(null)
  const [aspect, setAspect] = useState(16 / 10)
  const [on, setOn] = useState(false)

  useEffect(() => {
    let dead = false
    const ask = (): void => {
      // optional: a renderer hot-reloaded over an older preload has no such call
      void window.api.canvas
        .videoRegion?.(id)
        ?.then((r) => {
          if (dead) return
          // keep the same object when nothing moved, so the layout does not churn
          setRegion((was) =>
            r && was && SIDES.every((k) => Math.abs(r[k] - was[k]) < 0.002) ? was : r
          )
        })
        .catch(() => undefined)
    }
    ask()
    const timer = window.setInterval(ask, REGION_MS)
    return () => {
      dead = true
      window.clearInterval(timer)
    }
  }, [id])

  const width = region ? captureWidth(cardPx, window.devicePixelRatio || 1, region.w) : 0
  useEffect(() => {
    const v = video.current
    if (!width || !v) return
    let dead = false
    let stream: MediaStream | null = null
    void (async () => {
      const source = await window.api.canvas.streamSource?.(id)
      if (!source || dead) return
      // Chromium's tab capture takes the legacy `mandatory` form only; the id is bound to this page by main.
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: source,
            maxWidth: width,
            maxHeight: width,
            maxFrameRate: FPS
          }
        }
      } as unknown as MediaStreamConstraints)
      if (dead) return stop(s) // unmounted while it was being opened: no track is left running
      stream = s
      // the tab closed or its page went away: back to the picture
      s.getVideoTracks()[0]?.addEventListener('ended', () => setOn(false))
      v.srcObject = s
      void v.play().catch(() => undefined)
    })().catch(() => undefined)
    return () => {
      dead = true
      if (stream) stop(stream)
      v.srcObject = null
      setOn(false)
    }
  }, [id, width])

  if (!region) return null
  const f = fitRegion(region, aspect, CARD_W / CARD_H)
  return (
    <div className={'cv-live' + (on ? ' on' : '')} aria-hidden="true">
      <div className="cv-live-clip" style={{ width: `${f.clip.w}%`, height: `${f.clip.h}%` }}>
        <video
          ref={video}
          muted
          playsInline
          disablePictureInPicture
          style={{
            left: `${f.video.x}%`,
            top: `${f.video.y}%`,
            width: `${f.video.w}%`,
            height: `${f.video.h}%`
          }}
          onPlaying={() => setOn(true)}
          onResize={(e) => {
            const el = e.currentTarget
            if (el.videoWidth && el.videoHeight) setAspect(el.videoWidth / el.videoHeight)
          }}
        />
      </div>
    </div>
  )
}
