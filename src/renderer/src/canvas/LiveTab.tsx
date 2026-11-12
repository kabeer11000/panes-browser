import { useEffect, useRef, useState } from 'react'
import { CARD_H, CARD_W } from '@shared/ai/canvas'
import {
  captureWidth,
  fitRegion,
  streamCap,
  streamFps,
  WHOLE_PAGE,
  type VideoRegion
} from '@shared/ai/tabStream'
import { onBoardMotion } from './boardMotion'

const FPS = streamFps(streamCap(navigator))
/** How often the video's place in the page is asked again (theatre mode, scrolling): often at first and after
 * it moved, less once it has stayed put a while (each ask runs a script in the page). */
const REGION_MS = 1000
const REGION_SLOW_MS = 2500
/** Unchanged answers in a row before the asking slows down. */
const STEADY = 4
const SIDES = ['x', 'y', 'w', 'h'] as const

function stop(s: MediaStream): void {
  for (const t of s.getTracks()) t.stop()
}

/** The frame on screen in `v`, cut to what the card shows of it (`f`: fitRegion's answer), as a small JPEG. */
function grabStill(v: HTMLVideoElement, f: ReturnType<typeof fitRegion>): string | null {
  const vw = v.videoWidth
  const vh = v.videoHeight
  if (!vw || !vh || f.video.w <= 0 || f.video.h <= 0) return null
  const sx = Math.max(0, (-f.video.x / f.video.w) * vw)
  const sy = Math.max(0, (-f.video.y / f.video.h) * vh)
  const sw = Math.min(vw - sx, (100 / f.video.w) * vw)
  const sh = Math.min(vh - sy, (100 / f.video.h) * vh)
  if (sw < 2 || sh < 2) return null
  const scale = Math.min(1, 640 / sw)
  const c = document.createElement('canvas')
  c.width = Math.round(sw * scale)
  c.height = Math.round(sh * scale)
  const g = c.getContext('2d')
  if (!g) return null
  g.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height)
  try {
    return c.toDataURL('image/jpeg', 0.82)
  } catch {
    return null
  }
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
  onAspect,
  onStill,
  whole = false
}: {
  id: number
  cardPx: number
  cardAspect?: number
  site?: string
  title?: string
  onAspect?: (id: number, aspect: number) => void
  /** The last frame shown, when the stream stops (the tab paused or left the screen): the card keeps it. */
  onStill?: (id: number, src: string) => void
  /** Show the whole page, not the video in it (a call). Fixed for the component's life: key it by this. */
  whole?: boolean
}): React.JSX.Element | null {
  const video = useRef<HTMLVideoElement>(null)
  // while the board moves the video holds its frame (the stream keeps running, so it carries on at once)
  useEffect(
    () =>
      onBoardMotion((moving) => {
        const v = video.current
        if (!v?.srcObject) return
        if (moving) v.pause()
        else void v.play().catch(() => undefined)
      }),
    []
  )
  const [region, setRegion] = useState<VideoRegion | null>(whole ? WHOLE_PAGE : null)
  const [streamAspect, setStreamAspect] = useState<number | null>(null)
  // The crop comes from the page's answer: the stream shows only once it has a frame and an answer asked after the
  // stream began, so a player that moved (scrolled, theatre mode, reflowed) never shows the page around it.
  const [hasFrame, setHasFrame] = useState(false)
  const [freshRegion, setFreshRegion] = useState(whole)
  const startedAt = useRef(Infinity)
  const fitRef = useRef<ReturnType<typeof fitRegion> | null>(null)
  const onStillRef = useRef(onStill)
  /** Ask the page where its video is now (set by the asking effect; the stream calls it the moment it starts). */
  const askNow = useRef<() => void>(() => undefined)
  const lastRegion = useRef<VideoRegion | null>(null)
  useEffect(() => {
    onStillRef.current = onStill
  })
  const on = hasFrame && freshRegion

  useEffect(() => {
    if (whole) return // the whole page: nothing to look for
    let dead = false
    let steady = 0
    let timer = 0
    const ask = (): void => {
      const askedAt = performance.now()
      window.clearTimeout(timer)
      // optional: a renderer hot-reloaded over an older preload has no such call
      void window.api.canvas
        .videoRegion?.(id)
        ?.then((r) => {
          if (dead) return
          if (r && askedAt >= startedAt.current) setFreshRegion(true)
          // keep the same object when nothing moved, so the layout does not churn
          const was = lastRegion.current
          const same =
            !!r &&
            !!was &&
            SIDES.every((k) => Math.abs(r[k] - was[k]) < 0.002) &&
            Math.abs((r.pageAspect ?? 0) - (was.pageAspect ?? 0)) < 0.002
          steady = same ? steady + 1 : 0
          if (!same) {
            lastRegion.current = r
            setRegion(r)
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (dead) return
          window.clearTimeout(timer)
          timer = window.setTimeout(ask, steady >= STEADY ? REGION_SLOW_MS : REGION_MS)
        })
    }
    askNow.current = () => {
      steady = 0
      ask()
    }
    ask()
    // and once more shortly after streaming begins, in case main resized the hidden tab view, reflowing the player
    const t1 = window.setTimeout(() => askNow.current(), 300)
    return () => {
      dead = true
      askNow.current = () => undefined
      window.clearTimeout(t1)
      window.clearTimeout(timer)
    }
  }, [id, whole])

  const width = region ? captureWidth(cardPx, window.devicePixelRatio || 1, region.w) : 0
  const fallbackAr =
    typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0
      ? Math.max(800, window.innerWidth) / Math.max(600, window.innerHeight)
      : 16 / 10
  const pageAr = region?.pageAspect && region.pageAspect > 0 ? region.pageAspect : fallbackAr
  useEffect(() => {
    if (!region || !onAspect) return
    const ar = (region.w * pageAr) / region.h
    if (Number.isFinite(ar) && ar > 0.25 && ar < 4) onAspect(id, ar)
  }, [id, region, pageAr, onAspect])
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
      startedAt.current = performance.now()
      if (!whole) setFreshRegion(false)
      // the tab closed or its page went away: back to the picture
      s.getVideoTracks()[0]?.addEventListener('ended', () => setHasFrame(false))
      v.srcObject = s
      void v.play().catch(() => undefined)
      // where the video is, asked now that the stream runs: it shows as soon as both are in, not at the next tick
      askNow.current()
    })().catch(() => undefined)
    return () => {
      dead = true
      const f = fitRef.current
      const still = f && v.readyState >= 2 ? grabStill(v, f) : null
      if (still) onStillRef.current?.(id, still)
      if (stream) stop(stream)
      v.srcObject = null
      startedAt.current = Infinity
      setHasFrame(false)
    }
  }, [id, width, height, whole])

  const f = region
    ? fitRegion(
        region.pageAspect ? region : { ...region, pageAspect: pageAr },
        streamAspect ?? pageAr,
        cardAspect
      )
    : null
  useEffect(() => {
    fitRef.current = f
  })
  if (!f) return null
  const updateAspect = (el: HTMLVideoElement): void => {
    if (el.videoWidth && el.videoHeight) setStreamAspect(el.videoWidth / el.videoHeight)
  }
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
          onLoadedMetadata={(e) => updateAspect(e.currentTarget)}
          onLoadedData={(e) => {
            updateAspect(e.currentTarget)
            setHasFrame(true)
            if (!freshRegion) askNow.current()
          }}
          onPlaying={(e) => {
            updateAspect(e.currentTarget)
            setHasFrame(true)
          }}
          onResize={(e) => updateAspect(e.currentTarget)}
        />
      </div>
    </div>
  )
}
