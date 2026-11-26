import { describe, expect, test } from 'bun:test'
import * as Y from 'yjs'
import { CHAT_KEEP, chatOf, cleanMessage, sayIn, unreadAfter, watchChat } from './chat'

const ana = { name: 'Ana', color: '#22c55e' }

describe('chat in a shared space', () => {
  test('what is said is read back in order, trimmed; empty is not said', () => {
    const doc = new Y.Doc()
    expect(sayIn(doc, ana, '  hello  ', undefined, 1)).not.toBeNull()
    sayIn(doc, ana, 'second', undefined, 2)
    expect(sayIn(doc, ana, '   ')).toBeNull()
    const all = chatOf(doc)
    expect(all.map((m) => m.text)).toEqual(['hello', 'second'])
    expect(all[0]).toMatchObject({ name: 'Ana', color: '#22c55e', at: 1, by: doc.clientID })
  })

  test('two people writing at once both land, the same on both sides', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    sayIn(a, ana, 'from a')
    sayIn(b, { name: 'Bo', color: '#3b82f6' }, 'from b')
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    expect(chatOf(a).map((m) => m.text)).toEqual(chatOf(b).map((m) => m.text))
    expect(chatOf(a)).toHaveLength(2)
  })

  test('a room keeps the latest CHAT_KEEP; long messages are cut', () => {
    const doc = new Y.Doc()
    for (let i = 0; i < CHAT_KEEP + 5; i++) sayIn(doc, ana, `m${i}`)
    expect(doc.getArray('chat').length).toBe(CHAT_KEEP)
    expect(chatOf(doc, CHAT_KEEP).at(-1)?.text).toBe(`m${CHAT_KEEP + 4}`)
    expect(chatOf(doc, CHAT_KEEP)[0].text).toBe('m5')
    sayIn(doc, ana, 'x'.repeat(5000))
    expect(chatOf(doc).at(-1)?.text.length).toBe(2000)
  })

  test("anything odd someone wrote into the room's chat is left out", () => {
    expect(cleanMessage({ id: 'bad id!', text: 'x', at: 1 })).toBeNull()
    expect(cleanMessage({ id: 'abcdefgh', text: '  ', at: 1 })).toBeNull()
    expect(cleanMessage('hello')).toBeNull()
    expect(
      cleanMessage({ id: 'abcdefgh', text: 'hi', at: 1, color: 'red', name: '' })
    ).toMatchObject({
      color: '#888888',
      name: 'Someone'
    })
    const doc = new Y.Doc()
    doc.getArray('chat').push([{ nope: true }, { id: 'abcdefgh', text: 'ok', at: 3 }])
    expect(chatOf(doc).map((m) => m.text)).toEqual(['ok'])
  })

  test('unread: the others’ messages after the last one seen', () => {
    const doc = new Y.Doc()
    const m1 = sayIn(doc, ana, 'mine')!
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    sayIn(other, { name: 'Bo', color: '#3b82f6' }, 'theirs 1')
    sayIn(other, { name: 'Bo', color: '#3b82f6' }, 'theirs 2')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other))
    const all = chatOf(doc)
    expect(unreadAfter(all, m1.id, doc.clientID)).toBe(2)
    expect(unreadAfter(all, all.at(-1)!.id, doc.clientID)).toBe(0)
    expect(unreadAfter(all, null, doc.clientID)).toBe(2)
  })

  test('watching hears what is said now and later', () => {
    const doc = new Y.Doc()
    const heard: number[] = []
    const stop = watchChat(doc, (m) => heard.push(m.length))
    sayIn(doc, ana, 'one')
    stop()
    sayIn(doc, ana, 'two')
    expect(heard).toEqual([0, 1])
  })
})

describe('files offered in the chat', () => {
  const who = { name: 'Ali', color: '#112233' }
  const id = '0f8e2c1a-1b2c-4d5e-8f90-123456789abc'
  test('a file message keeps its file, its name made safe', () => {
    const doc = new Y.Doc()
    sayIn(doc, who, 'Shared a file', undefined, 1, { id, name: '../x/report.pdf', size: 10 })
    expect(chatOf(doc)[0]!.file).toEqual({ id, name: 'report.pdf', size: 10 })
  })
  test('a bad file is not said at all', () => {
    const doc = new Y.Doc()
    expect(sayIn(doc, who, 'x', undefined, 1, { id: 'bad id', name: 'a', size: 1 })).toBeNull()
    expect(chatOf(doc)).toHaveLength(0)
  })
  test('a message from the room with a bad file is kept as words only', () => {
    const base = { id: 'abcdefgh', text: 'hi', at: 1, by: 2 }
    expect(cleanMessage({ ...base, file: { id, name: 'a', size: -5 } })?.file).toBeUndefined()
    expect(cleanMessage({ ...base, file: 'x' })?.text).toBe('hi')
    expect(cleanMessage(base)?.file).toBeUndefined()
  })
})

describe('the chat as drawn', () => {
  const at = (h: number, min = 0, day = 26): number => new Date(2026, 10, day, h, min).getTime()
  const msg = (id: string, by: number, t: number): import('./chat').ChatMessage => ({
    id,
    name: `P${by}`,
    color: '#123456',
    text: id,
    at: t,
    by
  })
  const now = at(20)
  test('days are headed, runs from one person grouped', async () => {
    const { chatRows } = await import('./chat')
    const rows = chatRows(
      [
        msg('a1', 1, at(9, 0, 25)),
        msg('a2', 1, at(10, 0)),
        msg('a3', 1, at(10, 2)),
        msg('b1', 2, at(10, 3)),
        msg('a4', 1, at(10, 30))
      ],
      2,
      now
    )
    expect(rows.map((r) => (r.kind === 'day' ? r.label : r.m.id))).toEqual([
      'Yesterday',
      'a1',
      'Today',
      'a2',
      'a3',
      'b1',
      'a4'
    ])
    const m = Object.fromEntries(
      rows.flatMap((r) => (r.kind === 'msg' ? [[r.m.id, [r.first, r.last, r.mine]]] : []))
    )
    expect(m).toEqual({
      a1: [true, true, false],
      a2: [true, false, false],
      a3: [false, true, false],
      b1: [true, true, true],
      a4: [true, true, false]
    })
  })
  test('the faces on the tucked-away chat: the last writers, each once, never this person', async () => {
    const { recentWriters } = await import('./chat')
    const ms = [msg('1', 1, 1), msg('2', 3, 2), msg('3', 2, 3), msg('4', 1, 4), msg('5', 4, 5)]
    expect(recentWriters(ms, 2).map((p) => p.name)).toEqual(['P4', 'P1', 'P3'])
  })
})

test('someone back with a new session is still one face', async () => {
  const { recentWriters } = await import('./chat')
  const m = (id: string, by: number): import('./chat').ChatMessage => ({
    id,
    name: 'Ali',
    color: '#123456',
    text: id,
    at: 1,
    by
  })
  expect(recentWriters([m('1', 10), m('2', 11)], 99)).toHaveLength(1)
})
