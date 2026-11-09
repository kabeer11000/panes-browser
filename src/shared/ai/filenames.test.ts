import { describe, expect, test } from 'bun:test'
import { isGeneric, sanitize } from './filenames'

const NUL = String.fromCharCode(0)
const BS = String.fromCharCode(92)

describe('isGeneric', () => {
  test('generic names', () => {
    for (const n of [
      'download.pdf',
      'Download',
      'file.zip',
      'document.docx',
      'image.png',
      'image (2).png',
      'untitled',
      'IMG_1234.jpg',
      'IMG-20240101.jpg',
      'abc.txt',
      'a.b',
      '550e8400-e29b-41d4-a716-446655440000.pdf',
      'd41d8cd98f00b204e9800998ecf8427e.bin',
      'aGVsbG8gd29ybGQgZnJvbSBwYW5lcw12AB.dat',
      '1234567.pdf',
      'download (3)'
    ])
      expect(isGeneric(n)).toBe(true)
  })

  test('meaningful names', () => {
    for (const n of [
      'Quarterly report 2024.pdf',
      'invoice-march.pdf',
      'setup.exe',
      'my-thesis.docx',
      '東京旅行.pdf',
      'photo of the cat.jpg',
      'Resume_Kabeer.pdf'
    ])
      expect(isGeneric(n)).toBe(false)
  })
})

describe('sanitize', () => {
  test('keeps the original extension exactly, once', () => {
    expect(sanitize('Tax return 2024', '.pdf')).toBe('Tax return 2024.pdf')
    expect(sanitize('Tax return 2024.pdf', '.pdf')).toBe('Tax return 2024.pdf')
    expect(sanitize('Tax return 2024.PDF', '.pdf')).toBe('Tax return 2024.pdf')
    expect(sanitize('Report', '.TAR.GZ')).toBe('Report.TAR.GZ')
    expect(sanitize('Report', '')).toBe('Report')
  })

  test('path traversal and separators are gone', () => {
    expect(sanitize('../../x', '.pdf')).toBe('x.pdf')
    expect(sanitize(`..${BS}..${BS}windows${BS}system32`, '.exe')).toBe('windows system32.exe')
    expect(sanitize(`a/b${BS}c`, '.txt')).toBe('a b c.txt')
    expect(sanitize('....', '.txt')).toBeNull()
  })

  test('characters Windows refuses and control characters', () => {
    expect(sanitize('a<b>c:d"e|f?g*h', '.txt')).toBe('abcdefgh.txt')
    expect(sanitize(`a${NUL}b\nc`, '.txt')).toBe('a b c.txt')
  })

  test('reserved device names', () => {
    expect(sanitize('CON', '.txt')).toBe('CON_.txt')
    expect(sanitize('nul', '')).toBe('nul_')
    expect(sanitize('COM1', '.txt')).toBe('COM1_.txt')
    expect(sanitize('console', '.txt')).toBe('console.txt')
    expect(sanitize('nul.tar', '.gz')).toBe('nul_.tar.gz')
    expect(sanitize('aux.notes', '.pdf')).toBe('aux_.notes.pdf')
  })

  test('trailing dots and spaces', () => {
    expect(sanitize('  name. . ', '.pdf')).toBe('name.pdf')
  })

  test('unicode is kept', () => {
    expect(sanitize('東京旅行 été', '.pdf')).toBe('東京旅行 été.pdf')
  })

  test('empty gives null', () => {
    expect(sanitize('', '.pdf')).toBeNull()
    expect(sanitize('   ', '.pdf')).toBeNull()
    expect(sanitize('.pdf', '.pdf')).toBeNull()
    expect(sanitize('<>:|', '.pdf')).toBeNull()
  })

  test('length is capped at 80 before the extension', () => {
    const out = sanitize('a'.repeat(200), '.pdf') as string
    expect(out.length).toBe(84)
    expect(out.endsWith('.pdf')).toBe(true)
  })
})
