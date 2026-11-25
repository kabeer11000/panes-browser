import { describe, expect, test } from 'bun:test'
import type { DownloadInfo } from './types'
import {
  canAlwaysOpen,
  downloadMenu,
  downloadProgress,
  downloadStatus,
  extensionOf,
  formatBytes,
  formatLeft
} from './downloads'

const MB = 1024 * 1024
const dl = (over: Partial<DownloadInfo> = {}): DownloadInfo => ({
  id: 1,
  filename: 'report.pdf',
  url: 'https://example.com/report.pdf',
  savePath: 'C:/Downloads/report.pdf',
  total: 40 * MB,
  received: 10 * MB,
  state: 'progressing',
  time: 0,
  ...over
})
const actions = (items: ReturnType<typeof downloadMenu>): string[] =>
  items.map((i) => (i === 'separator' ? '-' : i.action))

describe('formatBytes / formatLeft', () => {
  test('bytes, then units with one decimal under 100', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(150 * MB)).toBe('150 MB')
  })
  test('time left rounds to what a person reads, never 0 s', () => {
    expect(formatLeft(0.2)).toBe('1 s left')
    expect(formatLeft(42)).toBe('42 s left')
    expect(formatLeft(150)).toBe('3 min left')
    expect(formatLeft(7200)).toBe('2 h left')
  })
})

describe('downloadStatus', () => {
  test('running: amount, speed and time left', () => {
    expect(downloadStatus(dl({ speed: 2 * MB }))).toBe('10.0 MB of 40.0 MB, 2.0 MB/s, 15 s left')
  })
  test('running with no speed yet: just the amount', () => {
    expect(downloadStatus(dl())).toBe('10.0 MB of 40.0 MB')
  })
  test('unknown size: only what has come, no time left', () => {
    expect(downloadStatus(dl({ total: 0, speed: MB }))).toBe('10.0 MB, 1.0 MB/s')
  })
  test('open when done leads the line', () => {
    expect(downloadStatus(dl({ openWhenDone: true }))).toBe(
      'Opening when complete, 10.0 MB of 40.0 MB'
    )
  })
  test('paused, finished, cancelled, failed', () => {
    expect(downloadStatus(dl({ state: 'paused' }))).toBe('Paused, 10.0 MB of 40.0 MB')
    expect(downloadStatus(dl({ state: 'completed', received: 40 * MB }))).toBe('40.0 MB')
    expect(downloadStatus(dl({ state: 'cancelled' }))).toBe('Cancelled')
    expect(downloadStatus(dl({ state: 'interrupted' }))).toBe('Failed')
  })
  test('a passing note wins, then a missing file', () => {
    expect(downloadStatus(dl({ state: 'completed', note: 'Opening...', missing: true }))).toBe(
      'Opening...'
    )
    expect(downloadStatus(dl({ state: 'completed', missing: true }))).toBe('File moved or deleted')
  })
})

describe('downloadProgress', () => {
  test('fraction and tone for each state', () => {
    expect(downloadProgress(dl())).toEqual({ value: 0.25, tone: 'run' })
    expect(downloadProgress(dl({ state: 'paused' }))).toEqual({ value: 0.25, tone: 'paused' })
    expect(downloadProgress(dl({ state: 'completed' }))).toEqual({ value: 1, tone: 'done' })
    expect(downloadProgress(dl({ state: 'interrupted' }))).toEqual({ value: 0.25, tone: 'failed' })
  })
  test('unknown size is indeterminate while running, empty when failed', () => {
    expect(downloadProgress(dl({ total: 0 })).value).toBeNull()
    expect(downloadProgress(dl({ total: 0, state: 'paused' })).value).toBeNull()
    expect(downloadProgress(dl({ total: 0, state: 'cancelled' })).value).toBe(0)
  })
  test('clamped when more arrives than was announced', () => {
    expect(downloadProgress(dl({ received: 50 * MB })).value).toBe(1)
  })
})

describe('always open', () => {
  test('extension, lowercase, empty without one', () => {
    expect(extensionOf('A.PDF')).toBe('pdf')
    expect(extensionOf('README')).toBe('')
  })
  test('never for files that run code, nor files with no extension', () => {
    expect(canAlwaysOpen('photo.jpg')).toBe(true)
    expect(canAlwaysOpen('setup.EXE')).toBe(false)
    expect(canAlwaysOpen('page.html')).toBe(false)
    expect(canAlwaysOpen('script.ps1')).toBe(false)
    expect(canAlwaysOpen('Makefile')).toBe(false)
  })
})

describe('downloadMenu', () => {
  test('running: Chrome order, with checks', () => {
    const m = downloadMenu(dl({ openWhenDone: true }), true)
    expect(actions(m)).toEqual([
      'open-when-done',
      'always-open',
      '-',
      'pause',
      'copy-link',
      'cancel'
    ])
    expect(m[0]).toMatchObject({ checked: true })
    expect(m[1]).toMatchObject({ checked: true })
  })
  test('paused offers Resume', () => {
    expect(actions(downloadMenu(dl({ state: 'paused' }), false))).toContain('resume')
  })
  test('finished: open, show, link, remove; open and show off when the file is gone', () => {
    const m = downloadMenu(dl({ state: 'completed' }), false)
    expect(actions(m)).toEqual(['open', 'always-open', '-', 'show', 'copy-link', 'remove'])
    const gone = downloadMenu(dl({ state: 'completed', missing: true }), false)
    expect(gone[0]).toMatchObject({ action: 'open', enabled: false })
  })
  test('an installer never offers Always open', () => {
    expect(actions(downloadMenu(dl({ filename: 'setup.exe' }), false))).not.toContain('always-open')
  })
  test('failed: retry; a file Panes wrote (no link) has no retry or copy link', () => {
    expect(actions(downloadMenu(dl({ state: 'interrupted' }), false))).toEqual([
      'retry',
      '-',
      'copy-link',
      'remove'
    ])
    const local = downloadMenu(dl({ state: 'cancelled', url: '' }), false)
    expect(local[0]).toMatchObject({ action: 'retry', enabled: false })
    expect(actions(local)).not.toContain('copy-link')
  })
})
