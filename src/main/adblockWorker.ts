import { parentPort } from 'node:worker_threads'
import { FiltersEngine } from '@ghostery/adblocker'
import { ADBLOCK_ENV, RESOURCES_URL, filterLists } from '../shared/adblock'

/**
 * Builds the ad blocking engine in a worker thread and posts it back serialized (or an error message).
 *
 * Parsing some 150,000 rules takes seconds of CPU and a few hundred MB of short-lived strings. Doing it here
 * keeps the main process (and so every window) responsive, and all of that memory goes away with the
 * thread: the main process only ever holds the finished engine.
 */

const TIMEOUT_MS = 60_000

async function text(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  // without this a missing list would be read as rules made of an error page
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.text()
}

async function build(): Promise<Uint8Array> {
  const lists = filterLists(new Date().getFullYear())
  const [texts, resources] = await Promise.all([
    Promise.all(
      lists.map((list) =>
        text(list.url).catch((err: unknown) => {
          if (list.optional) return ''
          throw err
        })
      )
    ),
    text(RESOURCES_URL)
  ])
  const engine = FiltersEngine.parse(texts.join('\n'), { loadPreprocessors: true })
  engine.updateEnv(new Map(ADBLOCK_ENV))
  engine.updateResources(resources, String(resources.length))
  return engine.serialize()
}

build().then(
  (data) => parentPort?.postMessage(data, [data.buffer as ArrayBuffer]),
  (err: unknown) => parentPort?.postMessage(String(err))
)
