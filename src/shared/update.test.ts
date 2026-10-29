import { describe, expect, test } from 'bun:test'
import {
  formatSpeed,
  friendlyUpdateError,
  nextUpdateState,
  notesText,
  type UpdateState
} from './update'

const idle: UpdateState = { kind: 'idle', checkedAt: 100 }
const found = (s: UpdateState): UpdateState =>
  nextUpdateState(s, { type: 'found', version: '0.2.0', notes: 'Fixes' })

describe('nextUpdateState', () => {
  test('a check keeps when it last finished, and ends in idle with the new time', () => {
    const checking = nextUpdateState(idle, { type: 'checking' })
    expect(checking).toEqual({ kind: 'checking', checkedAt: 100 })
    expect(nextUpdateState(checking, { type: 'none', at: 200 })).toEqual({
      kind: 'idle',
      checkedAt: 200
    })
  })

  test('finding an update, downloading it and finishing walks to ready', () => {
    const available = found(nextUpdateState(idle, { type: 'checking' }))
    expect(available).toEqual({ kind: 'available', version: '0.2.0', notes: 'Fixes' })
    const downloading = nextUpdateState(available, {
      type: 'progress',
      percent: 42.46,
      bytesPerSecond: 2048
    })
    expect(downloading).toEqual({
      kind: 'downloading',
      version: '0.2.0',
      notes: 'Fixes',
      percent: 42.5,
      bytesPerSecond: 2048
    })
    expect(nextUpdateState(downloading, { type: 'downloaded' })).toEqual({
      kind: 'ready',
      version: '0.2.0',
      notes: 'Fixes'
    })
  })

  test('progress is clamped to 0 to 100 and speed never goes negative', () => {
    const available = found(idle)
    const over = nextUpdateState(available, { type: 'progress', percent: 250, bytesPerSecond: -5 })
    expect(over).toMatchObject({ percent: 100, bytesPerSecond: 0 })
    const under = nextUpdateState(available, { type: 'progress', percent: -3, bytesPerSecond: 1 })
    expect(under).toMatchObject({ percent: 0 })
  })

  test('progress or a download finishing with nothing found is ignored', () => {
    expect(nextUpdateState(idle, { type: 'progress', percent: 50, bytesPerSecond: 1 })).toBe(idle)
    expect(nextUpdateState(idle, { type: 'downloaded' })).toBe(idle)
  })

  test('a second check cannot drag a download back to checking', () => {
    const downloading = nextUpdateState(found(idle), {
      type: 'progress',
      percent: 10,
      bytesPerSecond: 1
    })
    expect(nextUpdateState(downloading, { type: 'checking' })).toBe(downloading)
    const available = found(idle)
    expect(nextUpdateState(available, { type: 'checking' })).toBe(available)
  })

  test('a downloaded update is never undone by later events', () => {
    const ready = nextUpdateState(found(idle), { type: 'downloaded' })
    for (const e of [
      { type: 'checking' },
      { type: 'none', at: 5 },
      { type: 'found', version: '9.9.9', notes: '' },
      { type: 'error', message: 'boom', at: 5 }
    ] as const) {
      expect(nextUpdateState(ready, e)).toBe(ready)
    }
  })

  test('a disabled build stays disabled', () => {
    const off: UpdateState = { kind: 'disabled', reason: 'dev' }
    expect(nextUpdateState(off, { type: 'checking' })).toBe(off)
    expect(nextUpdateState(off, { type: 'error', message: 'x', at: 1 })).toBe(off)
  })

  test('an error records when it happened and truncates a huge message', () => {
    const state = nextUpdateState(idle, { type: 'error', message: 'x'.repeat(500), at: 300 })
    expect(state.kind).toBe('error')
    if (state.kind === 'error') {
      expect(state.message.length).toBe(200)
      expect(state.checkedAt).toBe(300)
    }
  })

  test('after an error a new check starts from the error time', () => {
    const err = nextUpdateState(idle, { type: 'error', message: 'x', at: 300 })
    expect(nextUpdateState(err, { type: 'checking' })).toEqual({ kind: 'checking', checkedAt: 300 })
  })
})

describe('friendlyUpdateError', () => {
  test('explains network, access and missing-release failures', () => {
    expect(friendlyUpdateError('net::ERR_INTERNET_DISCONNECTED')).toContain('internet connection')
    expect(friendlyUpdateError('getaddrinfo ENOTFOUND github.com')).toContain('internet connection')
    expect(friendlyUpdateError('HttpError: 404 Not Found')).toBe(
      'No published release was found yet.'
    )
    expect(friendlyUpdateError('Cannot find latest.yml')).toBe(
      'No published release was found yet.'
    )
    expect(friendlyUpdateError('Request failed: 403 Forbidden')).toContain('private')
  })

  test('falls back to the first line, and to a generic line for nothing', () => {
    expect(friendlyUpdateError('Weird failure\nstack line')).toBe('Weird failure')
    expect(friendlyUpdateError('')).toBe('Something went wrong while checking for updates.')
    expect(friendlyUpdateError('z'.repeat(400)).length).toBe(160)
  })
})

describe('notesText', () => {
  test('strips HTML to plain lines and decodes entities', () => {
    expect(notesText('<h2>New</h2><ul><li>Faster &amp; smoother</li><li>Fixes</li></ul>')).toBe(
      'New\nFaster & smoother\nFixes'
    )
  })

  test('joins per-version notes and ignores junk', () => {
    expect(notesText([{ note: 'One' }, { note: 'Two' }, null, 5])).toBe('One\n\nTwo')
    expect(notesText(null)).toBe('')
    expect(notesText(42)).toBe('')
  })
})

describe('formatSpeed', () => {
  test('scales from bytes to megabytes', () => {
    expect(formatSpeed(512)).toBe('512 B/s')
    expect(formatSpeed(2048)).toBe('2 KB/s')
    expect(formatSpeed(1.5 * 1024 * 1024)).toBe('1.5 MB/s')
  })
})
