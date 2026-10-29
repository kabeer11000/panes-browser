import { useEffect, useState } from 'react'

const cache = new Map<string, string | null>()
const SAMPLE = 12 // snapshots are averaged down to a SAMPLE x SAMPLE grid

/** Average colour of an image, pushed toward a pleasant glow (saturated, mid-light). Null for near-grey pages. */
async function glowFor(src: string): Promise<string | null> {
  if (cache.has(src)) return cache.get(src) ?? null
  const img = new Image()
  img.src = src
  try {
    await img.decode()
  } catch {
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SAMPLE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE)
  const px = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data

  // Weight by saturation so a white page with one coloured logo glows with the logo, not grey.
  let r = 0
  let g = 0
  let b = 0
  let wsum = 0
  for (let i = 0; i < px.length; i += 4) {
    const max = Math.max(px[i], px[i + 1], px[i + 2])
    const min = Math.min(px[i], px[i + 1], px[i + 2])
    const w = 0.15 + (max - min) / 255
    r += px[i] * w
    g += px[i + 1] * w
    b += px[i + 2] * w
    wsum += w
  }
  r /= wsum
  g /= wsum
  b /= wsum

  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const d = max - min
  let color: string | null = null
  if (d >= 0.08) {
    const l = (max + min) / 2
    const s = d / (1 - Math.abs(2 * l - 1))
    const h =
      max === r / 255
        ? ((g - b) / 255 / d + (g < b ? 6 : 0)) * 60
        : max === g / 255
          ? ((b - r) / 255 / d + 2) * 60
          : ((r - g) / 255 / d + 4) * 60
    color = `hsl(${Math.round(h)} ${Math.round(Math.min(0.85, Math.max(0.5, s)) * 100)}% 52%)`
  }
  cache.set(src, color)
  return color
}

/** Glow colour for a snapshot; falls back to the accent when the page has no real colour. */
export function useGlow(src: string | undefined): string {
  const [glow, setGlow] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!src) return
    void glowFor(src).then((c) => alive && setGlow(c))
    return () => {
      alive = false
    }
  }, [src])
  return src && glow ? glow : 'var(--accent)'
}

const edgeCache = new Map<string, string | null>()

/** Plain average colour of the right-hand fifth of a snapshot: what a shade laid over that edge of the page should be. */
async function edgeFor(src: string): Promise<string | null> {
  if (edgeCache.has(src)) return edgeCache.get(src) ?? null
  const img = new Image()
  img.src = src
  try {
    await img.decode()
  } catch {
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SAMPLE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const w = img.naturalWidth * 0.2
  ctx.drawImage(img, img.naturalWidth - w, 0, w, img.naturalHeight, 0, 0, SAMPLE, SAMPLE)
  const px = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < px.length; i += 4) {
    r += px[i]
    g += px[i + 1]
    b += px[i + 2]
  }
  const n = px.length / 4
  const color = `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`
  edgeCache.set(src, color)
  return color
}

/** The colour of a snapshot's right edge, or null until it is known (and for a page with no snapshot). */
export function useEdgeColor(src: string | undefined): string | null {
  const [edge, setEdge] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!src) return
    void edgeFor(src).then((c) => alive && setEdge(c))
    return () => {
      alive = false
    }
  }, [src])
  return src ? edge : null
}
