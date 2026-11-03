import { parentPort, workerData } from 'node:worker_threads'
import { Engine, FilterSet } from 'adblock-rs'
import { preprocess, type FilterList } from '@shared/adblock'

/**
 * Builds the two ad blocking engines in a worker thread from lists already downloaded by the main process
 * (src/main/adblock.ts), and posts them back serialized (or an error message).
 *
 * `all` holds every list; `firstParty` only the lists that also apply to a page's own requests in Standard
 * mode (see `decide` in src/shared/adblock.ts). Parsing some 150,000 rules takes CPU and a lot of short-lived
 * strings; doing it here keeps every window responsive, and that memory goes away with the thread.
 */

export interface BuildInput {
  lists: FilterList[]
  /** Each list's text, in the same order. */
  texts: string[]
  /** resources.json */
  resources: string
}

export interface BuiltEngines {
  all: ArrayBuffer
  firstParty: ArrayBuffer
}

function build({ lists, texts, resources }: BuildInput): BuiltEngines {
  const all = new FilterSet()
  const firstParty = new FilterSet()
  lists.forEach((list, i) => {
    const rules = preprocess(texts[i])
    const opts = { permissions: list.permissions }
    all.addFilters(rules, opts)
    if (list.firstParty) firstParty.addFilters(rules, opts)
  })
  const parsed = JSON.parse(resources) as unknown[]
  const serialize = (set: FilterSet): ArrayBuffer => {
    const engine = new Engine(set)
    engine.useResources(parsed)
    return engine.serialize()
  }
  return { all: serialize(all), firstParty: serialize(firstParty) }
}

try {
  const built = build(workerData as BuildInput)
  parentPort?.postMessage(built, [built.all, built.firstParty])
} catch (err) {
  parentPort?.postMessage(String(err))
}
