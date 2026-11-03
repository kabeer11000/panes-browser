import { parentPort, workerData } from 'node:worker_threads'
import { Engine, FilterSet } from 'adblock-rs'
import {
  CATALOG_URL,
  RESOURCES_URL,
  pickLists,
  preprocess,
  type CatalogEntry
} from '@shared/adblock'

/**
 * Builds the two ad blocking engines in a worker thread and posts them back serialized (or an error message).
 *
 * `all` holds every list; `firstParty` only the lists that also apply to a page's own requests in Standard
 * mode (see `decide` in src/shared/adblock.ts). Parsing some 150,000 rules takes seconds of CPU and a few
 * hundred MB of short-lived strings; doing it here keeps every window responsive, and that memory goes away
 * with the thread.
 *
 * workerData.fallbackResources: the resources.json bundled with the app, used when the published one cannot
 * be fetched.
 */

export interface BuiltEngines {
  all: ArrayBuffer
  firstParty: ArrayBuffer
  /** The resources the engines were built with, so the main process can give them to the loaded engines. */
  resources: string
}

const TIMEOUT_MS = 60_000

async function text(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  // without this a missing list would be read as rules made of an error page
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.text()
}

async function build(fallbackResources: string): Promise<BuiltEngines> {
  const lists = pickLists(JSON.parse(await text(CATALOG_URL)) as CatalogEntry[])
  const [texts, resources] = await Promise.all([
    Promise.all(lists.map((l) => text(l.url))),
    text(RESOURCES_URL).catch((err: unknown) => {
      console.warn('[adblock] using bundled resources:', err)
      return fallbackResources
    })
  ])
  const parsed = JSON.parse(resources) as unknown[]

  const all = new FilterSet()
  const firstParty = new FilterSet()
  lists.forEach((list, i) => {
    const rules = preprocess(texts[i])
    const opts = { permissions: list.permissions }
    all.addFilters(rules, opts)
    if (list.firstParty) firstParty.addFilters(rules, opts)
  })

  const serialize = (set: FilterSet): ArrayBuffer => {
    const engine = new Engine(set)
    engine.useResources(parsed)
    return engine.serialize()
  }
  return { all: serialize(all), firstParty: serialize(firstParty), resources }
}

build(
  String((workerData as { fallbackResources?: string } | null)?.fallbackResources ?? '[]')
).then(
  (built) => parentPort?.postMessage(built, [built.all, built.firstParty]),
  (err: unknown) => parentPort?.postMessage(String(err))
)
