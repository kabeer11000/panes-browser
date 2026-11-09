import { describe, expect, test } from 'bun:test'
import { classifyFile, classifyPaste, csvRows } from './canvasPaste'

describe('classifyPaste', () => {
  test('one address is a link (a bare domain gets https)', () => {
    expect(classifyPaste('https://example.com/a?b=1')).toEqual({
      kind: 'link',
      url: 'https://example.com/a?b=1'
    })
    expect(classifyPaste('  example.org/docs ')).toEqual({
      kind: 'link',
      url: 'https://example.org/docs'
    })
    // words around it make it a note
    expect(classifyPaste('see example.com').kind).toBe('note')
  })
  test('spreadsheet rows are a table', () => {
    const r = classifyPaste('Name\tCity\nAda\tLondon\nAlan\tWilmslow\n')
    expect(r).toEqual({ kind: 'table', text: 'Name\tCity\nAda\tLondon\nAlan\tWilmslow' })
    // one tab in one line is not a table
    expect(classifyPaste('a\tb\nplain line').kind).toBe('note')
  })
  test('task lists are checklists, whatever bullet they use', () => {
    expect(classifyPaste('- [ ] milk\n- [x] bread\n* [ ] eggs')).toEqual({
      kind: 'checklist',
      text: '[ ] milk\n[x] bread\n[ ] eggs'
    })
  })
  test('code keeps its indentation', () => {
    const src = 'function go() {\n  return 1;\n}\n'
    expect(classifyPaste(src)).toEqual({ kind: 'code', text: 'function go() {\n  return 1;\n}' })
    expect(classifyPaste('Dear team,\nthe plan is ready.\nThanks').kind).toBe('note')
  })
})

describe('classifyFile', () => {
  test('by type, then by name', () => {
    expect(classifyFile('a.PNG', '')).toBe('image')
    expect(classifyFile('scan', 'image/jpeg')).toBe('image')
    expect(classifyFile('paper.pdf', '')).toBe('pdf')
    expect(classifyFile('data.csv', '')).toBe('table')
    expect(classifyFile('main.ts', '')).toBe('code')
    expect(classifyFile('readme.md', '')).toBe('note')
    expect(classifyFile('notes', 'text/plain')).toBe('note')
    expect(classifyFile('setup.exe', 'application/octet-stream')).toBeNull()
  })
})

describe('csvRows', () => {
  test('quotes, doubled quotes, separators and line breaks inside quotes', () => {
    expect(csvRows('a,b\n"x, y","say ""hi"""\n"two\nlines",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z']
    ])
  })
  test('tab-separated and blank lines', () => {
    expect(csvRows('a\tb\n\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })
})
