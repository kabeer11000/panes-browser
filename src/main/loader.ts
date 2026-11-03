import { app } from 'electron'
import { readFileSync } from 'fs'
import ofs from 'original-fs'
import { join } from 'path'
import {
  chooseLayer,
  LAYERS_FOLDER,
  markBad,
  parseLayerState,
  shellId,
  STATE_NAME,
  type LayerState
} from '../shared/layers'

/**
 * The first code Panes runs (package.json `main`). It starts the newest app layer staged on this computer (see
 * shared/layers.ts), or the app Panes was installed with. It only reads two small files, so links handed to an
 * already running Panes are not slowed down, and it never touches the network.
 *
 * A layer is a whole app.asar, so its own code finds its pages and preloads beside itself (`__dirname`). This file is
 * never updated by a layer: it changes only with an installer, and LOADER_VERSION says when a layer depends on it.
 */

// The data folder an override names (tests, side-by-side copies) applies to everything, the layers included, and has to
// be set before anything reads it.
if (process.env['PANES_USERDATA']) app.setPath('userData', process.env['PANES_USERDATA'])

/** The build number the installed app was released as (0 for a development build). */
function builtInBuild(): number {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
      panesBuild?: unknown
    }
    return Number.isSafeInteger(pkg.panesBuild) ? (pkg.panesBuild as number) : 0
  } catch {
    return 0
  }
}

function writeState(dir: string, state: LayerState): void {
  try {
    const file = join(dir, STATE_NAME)
    ofs.writeFileSync(file + '.tmp', JSON.stringify(state))
    ofs.renameSync(file + '.tmp', file)
  } catch {
    // only bookkeeping: the next start decides again
  }
}

function readState(dir: string): LayerState {
  try {
    return parseLayerState(JSON.parse(ofs.readFileSync(join(dir, STATE_NAME), 'utf8')))
  } catch {
    return parseLayerState(null)
  }
}

/** The entry of the layer to start, or null for the installed app. */
function layerToStart(): { dir: string; build: number; file: string } | null {
  // A development build runs its own source, always.
  if (!app.isPackaged) return null
  const dir = join(app.getPath('userData'), LAYERS_FOLDER)
  const state = readState(dir)
  if (!state.current && !state.previous) return null
  const { run, crashed } = chooseLayer(state, {
    shell: shellId(process.versions.electron),
    builtInBuild: builtInBuild(),
    // original-fs: Electron's own fs would look inside the archive instead of at the file
    exists: (file) => ofs.existsSync(join(dir, file))
  })
  if (crashed !== null) writeState(dir, markBad(state, crashed))
  return run ? { dir, build: run.build, file: run.file } : null
}

function start(): void {
  let layer: ReturnType<typeof layerToStart> = null
  try {
    layer = layerToStart()
  } catch (err) {
    console.error('[loader] could not read the staged layers:', err)
  }
  // Loaded synchronously on purpose: the app registers its panes:// scheme and Chromium switches while it loads, and
  // both only count before the app is ready, which an import() would not wait for.
  if (layer) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- a path chosen at run time, loaded now
      require(join(layer.dir, layer.file, 'out', 'main', 'index.js'))
      return
    } catch (err) {
      // It failed while loading, so whatever it set up is half done: never start it again, and come back up on the
      // app Panes was installed with in a fresh process.
      console.error('[loader] layer failed to load:', err)
      writeState(layer.dir, markBad(readState(layer.dir), layer.build))
      app.relaunch()
      app.exit(0)
      return
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the installed app, beside this file
  require(join(__dirname, 'index.js'))
}

start()
