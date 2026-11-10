import { describe, expect, test } from 'bun:test'
import type { MenuAction, MenuEntry } from '../menu'
import {
  boardMenu,
  cardMenu,
  markMenu,
  noteMenu,
  sectionMenu,
  selectionMenu,
  type CardFacts
} from './canvasMenu'
import { noteOf } from './canvasPlace'
import { itemFor } from './canvasItems'

const acts = (m: MenuEntry[]): MenuAction[] => m.filter((x): x is MenuAction => x !== 'sep')
const get = (m: MenuEntry[], id: string): MenuAction | undefined => acts(m).find((x) => x.id === id)

const tab: CardFacts = {
  isTab: true,
  private: false,
  canLive: true,
  canPop: true,
  media: false,
  audible: false,
  muted: false,
  toggle: false,
  reader: false,
  answer: false,
  note: false,
  canDocument: false,
  link: true,
  section: 'f1',
  sections: [
    { id: 'f1', name: 'News' },
    { id: 'f2', name: 'Recipes' }
  ]
}

describe('card menu', () => {
  test('a tab: open first, close last, no media row', () => {
    const m = cardMenu(tab)
    expect(acts(m)[0].id).toBe('open')
    expect(acts(m).at(-1)).toMatchObject({ id: 'close', label: 'Close tab', danger: true })
    expect(get(m, 'play')).toBeUndefined()
    expect(m[0]).not.toBe('sep')
    expect(m.at(-1)).not.toBe('sep')
  })
  test('move to section lists the others, not its own', () => {
    const move = get(cardMenu(tab), 'move')!
    expect(acts(move.items!).map((x) => x.id)).toEqual(['move:f2', 'move:new'])
  })
  test('a playing video: pause and mute', () => {
    const m = cardMenu({ ...tab, media: true, audible: true })
    expect(get(m, 'play')!.label).toBe('Pause')
    expect(get(m, 'mute')).toMatchObject({ label: 'Mute', disabled: false })
  })
  test('a silent video: play, mute disabled', () => {
    const m = cardMenu({ ...tab, media: true })
    expect(get(m, 'play')!.label).toBe('Play')
    expect(get(m, 'mute')!.disabled).toBe(true)
  })
  test('a private tab: nothing goes to a model, no link to copy', () => {
    const m = cardMenu({ ...tab, private: true })
    expect(get(m, 'ask')!.disabled).toBe(true)
    expect(get(m, 'note')!.disabled).toBe(true)
    expect(get(m, 'copy')!.disabled).toBe(true)
  })
  test('a board-only card is removed, not closed; a note is not made twice', () => {
    const m = cardMenu({ ...tab, isTab: false, answer: true, note: true, link: false })
    expect(get(m, 'close')!.label).toBe('Remove from the board')
    expect(get(m, 'note')!.disabled).toBe(true)
    expect(get(m, 'duplicate')!.disabled).toBe(false)
  })
})

describe('selection menu', () => {
  const sel = { n: 3, private: 0, canSplit: false, inSection: true, allTabs: true, sections: [] }
  test('counts in the labels, side by side only for two', () => {
    const m = selectionMenu(sel)
    expect(get(m, 'ask')!.label).toBe('Ask about these 3')
    expect(get(m, 'note')!.label).toBe('Make notes of these 3')
    expect(get(m, 'split')!.disabled).toBe(true)
    expect(get(m, 'close')!.label).toBe('Close 3 tabs')
  })
  test('all private: no asking, no notes', () => {
    const m = selectionMenu({ ...sel, private: 3 })
    expect(get(m, 'ask')!.disabled).toBe(true)
    expect(get(m, 'note')!.disabled).toBe(true)
  })
})

describe('section, note, mark and board menus', () => {
  test('section: colour submenu marks the one in use; empty section cannot be tidied', () => {
    const m = sectionMenu({ inside: 0, sized: false, color: 2 })
    const colours = acts(get(m, 'color')!.items!)
    expect(colours.filter((c) => c.checked).map((c) => c.id)).toEqual(['color:2'])
    expect(get(m, 'tidy')!.disabled).toBe(true)
    expect(get(m, 'delete')!.label).toBe('Delete section')
  })
  test('note: six named colours, the current one checked (wrapping past the last)', () => {
    const items = acts(get(noteMenu({ color: 7 }), 'color')!.items!)
    expect(items.map((c) => c.label)).toEqual([
      'Yellow',
      'Pink',
      'Green',
      'Blue',
      'Purple',
      'Orange'
    ])
    expect(items.find((c) => c.checked)!.id).toBe('color:1')
  })
  test('marks: no fill only for shapes, delete disabled when locked', () => {
    const facts = { n: 1, editable: true, shapes: false, locked: false, grouped: false, color: 0 }
    expect(
      get(markMenu(facts), 'color')!.items!.some((x) => x !== 'sep' && x.id === 'color:none')
    ).toBe(false)
    expect(get(markMenu({ ...facts, shapes: true }), 'color')!.items!.at(-1)).toMatchObject({
      id: 'color:none'
    })
    expect(get(markMenu({ ...facts, locked: true }), 'delete')!.disabled).toBe(true)
  })
  test('board: paste only with a handler, empty board cannot be fitted', () => {
    const base = { empty: true, paste: false, canPaste: false, undo: null }
    expect(get(boardMenu(base), 'paste')).toBeUndefined()
    expect(get(boardMenu({ ...base, paste: true }), 'paste')!.disabled).toBe(true)
    expect(get(boardMenu(base), 'fit')!.disabled).toBe(true)
    expect(get(boardMenu({ ...base, undo: 'Moved a card' }), 'undo')!.label).toBe(
      'Undo moved a card'
    )
  })
})

describe('noteOf', () => {
  test('never keeps the tab (its card would leave the board), links back by address', () => {
    const page = itemFor('https://example.com/a', 'A page', { tab: 7, source: 'tab' })
    const n = noteOf(page, '- one\n- two')
    expect(n.tab).toBeUndefined()
    expect(n).toMatchObject({ kind: 'answer', placement: 'note' })
    expect(n.text).toContain('- one')
    expect(n.text).toContain('(https://example.com/a)')
  })
  test('pending: empty, so the card shows it is being written', () => {
    expect(noteOf(itemFor('https://example.com', 'X', { tab: 1 }), undefined, true).text).toBe('')
  })
  test('no summary: the title and the link', () => {
    expect(noteOf(itemFor('https://example.com', 'X'))).toMatchObject({
      text: 'X\n\nSource: [example.com](https://example.com)'
    })
  })
})
