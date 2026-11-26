import { useEffect, useRef, useState } from 'react'
import type { BackdropApi, BackdropLayer } from '@shared/types'

declare global {
  interface Window {
    /** Only in the floating views (preload/backdrop.ts). */
    backdrop?: BackdropApi
  }
}

/** Blurred anyway: captured at half the size on screen, a quarter of the work. */
const SCALE = 0.5
/** A source no card plays any more is stopped after this (a submenu closing as another opens keeps it). */
const LINGER_MS = 400
/** Longer than any card's opening: asked again then, at its place at rest. */
const SETTLE_MS = 450

/** One capture per thing under the view (the window's interface, a page), shared by every card over it. */
const streams = new Map<
  string,
  { stream: Promise<MediaStream | null>; refs: number; timer?: ReturnType<typeof setTimeout> }
>()
const keyOf = (l: BackdropLayer): string => `${l.x},${l.y},${l.width},${l.height}`

function take(l: BackdropLayer): Promise<MediaStream | null> {
  const key = keyOf(l)
  let s = streams.get(key)
  if (!s) {
    const d = (window.devicePixelRatio || 1) * SCALE
    const stream = navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: l.source,
            maxWidth: Math.max(1, Math.round(l.width * d)),
            maxHeight: Math.max(1, Math.round(l.height * d)),
            maxFrameRate: 30
          }
        }
      } as unknown as MediaStreamConstraints)
      .catch(() => null)
    s = { stream, refs: 0 }
    streams.set(key, s)
  }
  clearTimeout(s.timer)
  s.refs++
  return s.stream
}

function give(l: BackdropLayer): void {
  const key = keyOf(l)
  const s = streams.get(key)
  if (!s || --s.refs > 0) return
  s.timer = setTimeout(() => {
    if (s.refs > 0) return
    streams.delete(key)
    void s.stream.then((m) => m?.getTracks().forEach((t) => t.stop()))
  }, LINGER_MS)
}

const glassOn = (): boolean => {
  const d = document.documentElement.dataset
  return d.glass === 'on' && d.fx !== 'low' && !!window.backdrop
}

/**
 * Frosted glass for a card in a floating view (a view of its own above the pages, which cannot blur them): what is
 * under the card, live and blurred, with the glass tint over it (styles.css .bd). Put it first in the card. Until the
 * first frame is in, the card is the solid card it always was. Plays only while the view is shown.
 */
export function Backdrop(): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [under, setUnder] = useState<{ layers: BackdropLayer[]; x: number; y: number } | null>(null)
  const [ready, setReady] = useState(false)
  const [shown, setShown] = useState(!document.hidden)

  useEffect(() => {
    const vis = (): void => setShown(!document.hidden)
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [])

  // what is under the card: asked for as it is shown, and again once it has settled (its opening animation scales
  // it) or moved or been resized
  useEffect(() => {
    const host = box.current?.parentElement
    if (!host || !shown || !glassOn()) {
      setUnder(null)
      setReady(false)
      return
    }
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
    host.classList.add('bd-host')
    let dead = false
    let last = ''
    const ask = (): void => {
      const r = host.getBoundingClientRect()
      void window
        .backdrop!.layers({ x: r.left, y: r.top, width: r.width, height: r.height })
        .then((ls) => {
          if (dead || !ls) return
          const sig = ls.map(keyOf).join('|') + `@${Math.round(r.left)},${Math.round(r.top)}`
          if (sig === last) return // the same things in the same places: keep playing what plays
          last = sig
          setUnder({ layers: ls, x: r.left, y: r.top })
        })
    }
    ask()
    // once settled from an animation driven from script or by a parent (the downloads fan, the permission card)
    const settled = setTimeout(ask, SETTLE_MS)
    const ro = new ResizeObserver(ask)
    ro.observe(host)
    host.addEventListener('animationend', ask)
    window.addEventListener('resize', ask)
    return () => {
      dead = true
      clearTimeout(settled)
      ro.disconnect()
      host.removeEventListener('animationend', ask)
      window.removeEventListener('resize', ask)
    }
  }, [shown])

  return (
    <div ref={box} className={'bd' + (ready && under ? ' on' : '')} aria-hidden="true">
      {under && (
        <div className="bd-blur">
          {under.layers.map((l) => (
            <Layer
              key={keyOf(l)}
              layer={l}
              x={l.x - under.x}
              y={l.y - under.y}
              onReady={() => setReady(true)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Layer({
  layer,
  x,
  y,
  onReady
}: {
  layer: BackdropLayer
  x: number
  y: number
  onReady: () => void
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    let dead = false
    void take(layer).then((s) => {
      const v = video.current
      if (dead || !s || !v) return
      v.srcObject = s
      void v.play().catch(() => undefined)
    })
    const v = video.current
    return () => {
      dead = true
      if (v) v.srcObject = null
      give(layer)
    }
    // keyed by its place and size: one capture for its life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <video
      ref={video}
      muted
      playsInline
      style={{ left: x, top: y, width: layer.width, height: layer.height }}
      onLoadedData={onReady}
    />
  )
}
