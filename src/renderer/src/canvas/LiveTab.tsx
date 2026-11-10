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
const REGION_MS = 2000
const SIDES = ['x', 'y', 'w', 'h'] as const

function stop(s: MediaStream): void {
  for (const t of s.getTracks()) t.stop()
}

/**
 * A playing tab, live on its card: the tab's own page streamed (tab capture, video only, so the sound stays in the
 * tab and is never doubled), cropped to the video playing in it. A tab with no playing video in view is not
 * streamed: the card keeps its picture and its media controls.
 */
export function LiveTab({
  id,
  cardPx,
  cardAspect = CARD_W / CARD_H,
  site,
  title
}: {
  id: number
  cardPx: number
  cardAspect?: number
  site?: string
  title?: string
}): React.JSX.Element | null {
  const video = useRef<HTMLVideoElement>(null)
  const [region, setRegion] = useState<VideoRegion | null>(null)
  const [streamAspect, setStreamAspect] = useState<number | null>(null)
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
            r &&
            was &&
            SIDES.every((k) => Math.abs(r[k] - was[k]) < 0.002) &&
            Math.abs((r.pageAspect ?? 0) - (was.pageAspect ?? 0)) < 0.002
              ? was
              : r
          )
        })
        .catch(() => undefined)
    }
    ask()
    // Ask again shortly after streaming begins in case main resized the hidden tab view, reflowing the player.
    const t1 = window.setTimeout(ask, 280)
    const t2 = window.setTimeout(ask, 950)
    const timer = window.setInterval(ask, REGION_MS)
    return () => {
      dead = true
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearInterval(timer)
    }
  }, [id])

  const width = region ? captureWidth(cardPx, window.devicePixelRatio || 1, region.w) : 0
  const fallbackAr =
    typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0
      ? Math.max(800, window.innerWidth) / Math.max(600, window.innerHeight)
      : 16 / 10
  const pageAr = region?.pageAspect && region.pageAspect > 0 ? region.pageAspect : fallbackAr
  const height = width ? Math.max(180, Math.round(width / pageAr / 2) * 2) : 0
  useEffect(() => {
    const v = video.current
    if (!width || !height || !v) return
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
            maxHeight: height,
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
  }, [id, width, height])

  if (!region) return null
  const aspect = streamAspect ?? pageAr
  const f = fitRegion(
    region.pageAspect ? region : { ...region, pageAspect: pageAr },
    aspect,
    cardAspect
  )
  const carded = f.clip.w >= 99.5 && f.clip.h < 72 && !!(title || site)
  const updateAspect = (el: HTMLVideoElement): void => {
    if (el.videoWidth && el.videoHeight) setStreamAspect(el.videoWidth / el.videoHeight)
  }
  return (
    <div
      className={'cv-live' + (on ? ' on' : '') + (carded ? ' carded' : '')}
      aria-hidden="true"
    >
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
          onLoadedMetadata={(e) => updateAspect(e.currentTarget)}
          onPlaying={(e) => {
            updateAspect(e.currentTarget)
            setOn(true)
          }}
          onResize={(e) => updateAspect(e.currentTarget)}
        />
      </div>
      {carded && (
        <div className="cv-doc-body cv-live-body">
          {site ? <span className="cv-site">{site}</span> : null}
          {title ? <h3>{title}</h3> : null}
        </div>
      )}
    </div>
  )
}
