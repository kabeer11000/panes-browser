/*
 * Builds the icon files electron-builder and the window need from the logo
 * (src/renderer/src/assets/logo.png, the transparent-background mark; swap in logo-light.png for the tile version).
 * Sizes larger than the source are skipped rather than blurred up. Run with Electron:
 *
 *   node_modules/electron/dist/electron.exe scripts/render-icons.cjs
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const source = readFileSync(join(root, 'src/renderer/src/assets/logo.png'))
const WANTED = [1024, 512, 256, 128, 64, 48, 32, 16]

/** PNGs wrapped in an ICO container (supported since Windows Vista). */
function buildIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = 6 + dir.length
  pngs.forEach(({ size, data }, i) => {
    const e = i * 16
    dir[e] = size >= 256 ? 0 : size
    dir[e + 1] = size >= 256 ? 0 : size
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(data.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)])
}

/** PNG-based ICNS: ic07 = 128, ic08 = 256, ic09 = 512, ic10 = 1024. Only sizes we have are written. */
function buildIcns(bySize) {
  const types = { 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' }
  const chunks = Object.entries(types)
    .filter(([size]) => bySize[size])
    .map(([size, type]) => {
      const head = Buffer.alloc(8)
      head.write(type, 0, 'ascii')
      head.writeUInt32BE(8 + bySize[size].length, 4)
      return Buffer.concat([head, bySize[size]])
    })
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([head, body])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('data:text/html,<html></html>')
  const dataUrls = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/png;base64,${source.toString('base64')}'
    await img.decode()
    const out = { natural: img.naturalWidth }
    for (const size of ${JSON.stringify(WANTED)}) {
      if (size > img.naturalWidth) continue
      const c = document.createElement('canvas')
      c.width = c.height = size
      const ctx = c.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, size, size)
      out[size] = c.toDataURL('image/png')
    }
    return out
  })()`)

  const bySize = {}
  for (const size of WANTED) {
    if (dataUrls[size]) bySize[size] = Buffer.from(dataUrls[size].split(',')[1], 'base64')
  }
  const largest = Math.max(...Object.keys(bySize).map(Number))

  mkdirSync(join(root, 'build'), { recursive: true })
  mkdirSync(join(root, 'resources'), { recursive: true })
  writeFileSync(join(root, 'build/icon.png'), bySize[largest])
  writeFileSync(join(root, 'resources/icon.png'), bySize[Math.min(512, largest)])
  writeFileSync(
    join(root, 'build/icon.ico'),
    buildIco(
      [256, 128, 64, 48, 32, 16]
        .filter((s) => bySize[s])
        .map((size) => ({ size, data: bySize[size] }))
    )
  )
  writeFileSync(join(root, 'build/icon.icns'), buildIcns(bySize))
  console.log('source', dataUrls.natural + 'px; icons written:', Object.keys(bySize).join(', '))
  app.quit()
})
