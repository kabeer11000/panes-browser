import { useEffect, useState, type RefObject } from 'react'
import { ditherDuotone, duotone, levelsOf, lumaOf } from '../../../shared/dither'
import { photoUrl } from '../../../shared/photos'

/** One dither cell is this many CSS pixels at a device pixel ratio of 1 (see `cellOf`). */
const CELL = 3
/** How far, in CSS pixels, the canvas reaches past the page on every side: room for the parallax to drift in. */
export const DITHER_PAD = 34
/** The picture is fetched at this size, whatever the window: it is brought down to the grid anyway. */
const SOURCE = { width: 1280, height: 720 }

export interface DitherGrid {
  cols: number
  rows: number
  /** The canvas's size on screen, in CSS pixels: a whole number of device pixels per cell, so nothing blurs or beats. */
  width: number
  height: number
}

/**
 * A cell is a whole number of device pixels, or the pattern's even grain turns uneven (and shimmers) wherever the
 * picture is scaled up by a fraction. On a high-density screen the cell stays about the same size to the eye.
 */
function cellOf(dpr: number): { device: number; css: number } {
  const device = Math.max(2, Math.round(CELL * dpr))
  return { device, css: device / dpr }
}

/**
 * The page's photo as a dithered two-tone picture on a canvas: fetched once per photo, and brought down to a grid of
 * cells that fits the page (so it is redone when the page is resized, not stretched), then drawn in the space's
 * colours (so a change of space only redraws). Reports `failed` when the photo cannot be read as pixels (the picture
 * server stopped allowing it, say), and the page then shows the plain photo instead.
 */
export function useDitheredPhoto(
  on: boolean,
  id: number,
  colors: { color: string; color2: string | null } | null,
  root: RefObject<HTMLElement | null>,
  canvas: RefObject<HTMLCanvasElement | null>
): { ready: boolean; failed: boolean; grid: DitherGrid | null } {
  const [grid, setGrid] = useState<DitherGrid | null>(null)
  const [source, setSource] = useState<HTMLImageElement | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const color = colors?.color ?? null
  const color2 = colors?.color2 ?? null

  // the grid, from the page's size
  useEffect(() => {
    const el = root.current
    if (!on || !el) return
    const measure = (): void => {
      const dpr = window.devicePixelRatio || 1
      const { css } = cellOf(dpr)
      const cols = Math.ceil((el.clientWidth + DITHER_PAD * 2) / css)
      const rows = Math.ceil((el.clientHeight + DITHER_PAD * 2) / css)
      setGrid((g) =>
        g && g.cols === cols && g.rows === rows && g.width === cols * css
          ? g
          : { cols, rows, width: cols * css, height: rows * css }
      )
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [on, root])

  // the photo
  useEffect(() => {
    if (!on) return
    let alive = true
    const img = new Image()
    img.crossOrigin = 'anonymous' // or its pixels cannot be read
    img.onload = () => alive && setSource(img)
    img.onerror = () => alive && setFailed(true)
    img.src = photoUrl(id, SOURCE.width, SOURCE.height)
    return () => {
      alive = false
    }
  }, [on, id])

  // The picture at the grid's size (filling the grid, centred, cropped on the long side), drawn in the space's colours.
  // A change of space comes through here too: bringing a photo down to a few hundred cells is a few milliseconds.
  useEffect(() => {
    if (!source || !grid) return
    // asynchronously: a failure is reported from here, not set while the effect is still running
    const fail = (): void => void Promise.resolve().then(() => setFailed(true))
    const off = document.createElement('canvas')
    off.width = grid.cols
    off.height = grid.rows
    const from = off.getContext('2d', { willReadFrequently: true })
    const el = canvas.current
    const to = el?.getContext('2d')
    if (!from || !el || !to) return fail()
    const k = Math.max(grid.cols / source.naturalWidth, grid.rows / source.naturalHeight)
    const sw = grid.cols / k
    const sh = grid.rows / k
    from.imageSmoothingQuality = 'high'
    from.drawImage(
      source,
      (source.naturalWidth - sw) / 2,
      (source.naturalHeight - sh) / 2,
      sw,
      sh,
      0,
      0,
      grid.cols,
      grid.rows
    )
    let luma: Uint8Array
    try {
      luma = lumaOf(from.getImageData(0, 0, grid.cols, grid.rows).data)
    } catch {
      return fail() // a picture that will not give up its pixels
    }
    const out = ditherDuotone(luma, grid.cols, grid.rows, duotone(color, color2), levelsOf(luma))
    // (the canvas takes its size from the grid as props, see NewTab: it has been resized and cleared by now)
    to.putImageData(new ImageData(out, grid.cols, grid.rows), 0, 0)
    void Promise.resolve().then(() => setReady(true))
  }, [source, grid, color, color2, canvas])

  return { ready, failed, grid }
}
