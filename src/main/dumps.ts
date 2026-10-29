import { dumpName, MAX_DUMPS, sanitizeName, type DumpTab, type TabDump } from '../shared/dumps'
import { JsonStore } from './store'

interface DumpData {
  nextId: number
  items: TabDump[] // newest first
}

/** Saved sets of tabs ("sessions"), kept on disk. */
export class DumpStore {
  private store = new JsonStore<DumpData>('tab-dumps', { nextId: 1, items: [] })

  list(): TabDump[] {
    return this.store.value.items
  }

  add(tabs: DumpTab[]): TabDump | null {
    if (tabs.length === 0) return null
    const d = this.store.value
    const time = Date.now()
    const dump: TabDump = { id: d.nextId++, name: dumpName(time), time, tabs }
    d.items = [dump, ...d.items].slice(0, MAX_DUMPS)
    this.store.save()
    return dump
  }

  get(id: number): TabDump | undefined {
    return this.store.value.items.find((x) => x.id === id)
  }

  rename(id: number, name: unknown): void {
    const dump = this.get(id)
    if (!dump) return
    dump.name = sanitizeName(name, dump.name)
    this.store.save()
  }

  remove(id: number): void {
    const d = this.store.value
    d.items = d.items.filter((x) => x.id !== id)
    this.store.save()
  }
}
