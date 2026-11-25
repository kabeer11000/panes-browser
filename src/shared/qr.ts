import qrcode from 'qrcode-generator'

/** A QR code as a bitmap: dark modules black on white, `scale` pixels each, `margin` modules of quiet zone round it. */
export function qrBitmap(
  text: string,
  scale = 8,
  margin = 4
): { width: number; height: number; bgra: Uint8Array } {
  const qr = qrcode(0, 'M') // the smallest version that holds it; M survives a smudged screen
  qr.addData(text, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  const side = (n + margin * 2) * scale
  const bgra = new Uint8Array(side * side * 4).fill(255)
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue
      for (let y = 0; y < scale; y++) {
        const row = ((r + margin) * scale + y) * side
        for (let x = 0; x < scale; x++) {
          const at = (row + (c + margin) * scale + x) * 4
          bgra[at] = bgra[at + 1] = bgra[at + 2] = 0
        }
      }
    }
  return { width: side, height: side, bgra }
}
