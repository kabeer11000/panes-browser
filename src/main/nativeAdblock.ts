import { app } from 'electron'
import fs from 'fs'
import ofs from 'original-fs'
import Module from 'module'
import { join } from 'path'
import type * as AdblockRs from 'adblock-rs'

/**
 * Brave's adblock-rs, loaded when the blocker first needs it rather than as the main process starts, and from a copy
 * of its native library kept in the data folder.
 *
 * Its library (about 9 MB) is inside app.asar, and nothing may be unpacked beside it (see main/loader.ts). Electron
 * then writes it to a new temporary file on every start to load it, and Windows scans a newly written DLL before it
 * loads: 320 ms of every start, before the window. The copy here is written once per app build (named by its size
 * and the archive's time) and loaded as it is after that; the package's own `require('./index.node')` finds it
 * already loaded. Anything wrong with the copy: loaded the usual way instead.
 */
let loaded: typeof AdblockRs | null = null

export function adblockRs(): typeof AdblockRs {
  if (loaded) return loaded
  try {
    preloadKeptCopy()
  } catch {
    // Electron extracts and loads it itself, as before
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  loaded = require('adblock-rs') as typeof AdblockRs
  return loaded
}

const KEPT_PREFIX = 'adblock-'

function preloadKeptCopy(): void {
  const src = require.resolve('adblock-rs/js/index.node')
  const at = src.toLowerCase().indexOf('.asar')
  if (at < 0) return // a development build: a real file on disk already
  const archive = src.slice(0, at + 5)
  const size = fs.statSync(src).size
  const stamp = Math.round(ofs.statSync(archive).mtimeMs)
  const dir = join(app.getPath('userData'), 'native')
  const file = join(dir, `${KEPT_PREFIX}${size}-${stamp}.node`)
  if (!ofs.existsSync(file)) {
    ofs.mkdirSync(dir, { recursive: true })
    // another build's copy is of no more use (one still loaded by a running Panes stays until next time)
    for (const old of ofs.readdirSync(dir))
      if (old.startsWith(KEPT_PREFIX))
        try {
          ofs.unlinkSync(join(dir, old))
        } catch {
          // in use
        }
    ofs.writeFileSync(file + '.tmp', fs.readFileSync(src))
    ofs.renameSync(file + '.tmp', file)
  }
  const m = new Module(src)
  m.filename = src
  process.dlopen(m, file)
  m.loaded = true
  require.cache[src] = m
}
