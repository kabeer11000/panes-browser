import { Lru } from '@shared/lru'

/**
 * Card pictures that never flash. An <img> put on the page decodes its picture after it is shown, so a card that comes
 * into view, or the whole board crossing the zoom where cards show less, showed blank boxes for a frame or more, all at
 * once. Here a picture is shown only once it is decoded (kept ready for a while after its card leaves the screen), and
 * each picture has a small copy for a board zoomed far out: going in and out of that zoom changes only how sharp the
 * pictures are.
 */

/** Width of the small copy: a card zoomed out below LOD_K is well under this on screen. */
const SMALL_W = 224
/** Decoded pictures kept ready for cards that come back, in pixels (about 128 MB at most, most are far smaller). */
const FULL_PX = 32_000_000
/** Small copies kept (each a few KB). */
const SMALL_KEEP = 1000
/** Pictures decoded at once (off the main thread): more only queue up behind each other there. */
const AT_ONCE = 3

export const full = new Lru<string, HTMLImageElement>(FULL_PX)
export const small = new Lru<string, string>(SMALL_KEEP, (_k, url) => {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
})
export const bad = new Set<string>()
const pending = new Map<string, Promise<void>>()
const queue: Array<() => void> = []
let running = 0

function slot(): Promise<() => void> {
  return new Promise((resolve) => {
    const go = (): void => {
      running++
      let done = false
      resolve(() => {
        if (done) return
        done = true
        running--
        queue.shift()?.()
      })
    }
    if (running < AT_ONCE) go()
    else queue.push(go)
  })
}

async function shrink(src: string, img: HTMLImageElement): Promise<void> {
  if (small.has(src)) return
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (w <= SMALL_W * 1.4) {
    small.set(src, src) // small already
    return
  }
  const sw = SMALL_W
  const sh = Math.max(1, Math.round((h * sw) / w))
  try {
    const bmp = await createImageBitmap(img, {
      resizeWidth: sw,
      resizeHeight: sh,
      resizeQuality: 'medium'
    })
    const c = new OffscreenCanvas(sw, sh)
    c.getContext('2d')?.drawImage(bmp, 0, 0)
    bmp.close()
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
    small.set(src, URL.createObjectURL(blob))
  } catch {
    small.set(src, src) // a picture from another site cannot be read back: it is its own small copy
  }
}

/** Decode `src` (and make its small copy) once, however many cards ask. */
export function prepare(src: string): Promise<void> {
  if (full.has(src) && small.has(src)) return Promise.resolve()
  let p = pending.get(src)
  if (p) return p
  p = (async () => {
    const release = await slot()
    try {
      let img = full.get(src)
      if (!img) {
        img = new Image()
        img.decoding = 'async'
        img.src = src
        await img.decode()
        full.set(src, img, Math.max(1, img.naturalWidth * img.naturalHeight))
      }
      await shrink(src, img)
    } catch {
      bad.add(src)
    } finally {
      release()
    }
  })().finally(() => pending.delete(src))
  pending.set(src, p)
  return p
}

/** Small copies of pictures cards may show, made while nothing else is going on (a board opened zoomed out). */
export function warmPics(srcs: Iterable<string>): () => void {
  const todo = [...srcs].filter((s) => s && !small.has(s) && !bad.has(s))
  let dead = false
  let idle = 0
  const next = (): void => {
    if (dead) return
    const s = todo.shift()
    if (!s) return
    void prepare(s).then(() => {
      if (!dead) idle = requestIdleCallback(next, { timeout: 2000 })
    })
  }
  idle = requestIdleCallback(next, { timeout: 2000 })
  return () => {
    dead = true
    cancelIdleCallback(idle)
  }
}
