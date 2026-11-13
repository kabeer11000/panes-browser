import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'panes-store-'))
mock.module('electron', () => ({ app: { getPath: () => dir } }))
const { JsonStore } = await import('./store')

const onDisk = (name: string): unknown =>
  JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'))
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('JsonStore', () => {
  test('a burst of saves lands as the last value', async () => {
    const s = new JsonStore('burst', { n: 0 })
    for (let i = 1; i <= 5; i++) {
      s.value = { n: i }
      s.save()
    }
    await wait(700)
    expect(onDisk('burst')).toEqual({ n: 5 })
  })

  test('a save while a write runs is written after it', async () => {
    const s = new JsonStore('again', { n: 0 })
    s.value = { n: 1 }
    s.save()
    await wait(510) // the first write has started
    s.value = { n: 2 }
    s.save()
    await wait(700)
    expect(onDisk('again')).toEqual({ n: 2 })
  })

  test('a flush on quit is not overwritten by an older write still running', async () => {
    const s = new JsonStore('quit', { n: 0 })
    s.value = { n: 1 }
    s.save()
    await wait(505)
    s.value = { n: 2 }
    s.flush()
    await wait(200)
    expect(onDisk('quit')).toEqual({ n: 2 })
  })
})
