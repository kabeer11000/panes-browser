/**
 * Card pictures' small copies (pics.ts) encoded off the main thread: the page hands over a shrunk bitmap (made from the
 * picture it already decoded), and the JPEG is made here. A board full of new pictures (Tidy moving every card into
 * view, a board opened for the first time) spent the interface's thread on that encoding and its garbage (measured:
 * about 470 ms of encoding and 460 ms of GC for 120 cards, with frames of 250 ms while the cards moved).
 */
type Ask = { id: number; bmp: ImageBitmap }

self.onmessage = async (e: MessageEvent<Ask>): Promise<void> => {
  const { id, bmp } = e.data
  const reply = (blob: Blob | null): void => (self as unknown as Worker).postMessage({ id, blob })
  try {
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    c.getContext('2d')?.drawImage(bmp, 0, 0)
    reply(await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 }))
  } catch {
    reply(null)
  } finally {
    bmp.close()
  }
}
