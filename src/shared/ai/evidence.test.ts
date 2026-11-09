import { describe, expect, test } from 'bun:test'
import { deflateSync, inflateSync } from 'zlib'
import {
  acceptSuggestion,
  buildFilenamePrompt,
  CAPS,
  imageMeta,
  pdfInfo,
  pdfText,
  textSnippet,
  urlHints
} from './evidence'

const bytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'latin1'))
const inflate = (b: Uint8Array): Uint8Array | null => {
  try {
    return new Uint8Array(inflateSync(b))
  } catch {
    return null
  }
}

describe('urlHints', () => {
  test('path segments and name-like params, decoded', () => {
    const h = urlHints(
      'https://x.com/files/Q3%20Board%20Deck/get?id=123&filename=Q3+deck.pptx&token=abc'
    )
    expect(h.segments).toEqual(['files', 'Q3 Board Deck', 'get'])
    expect(h.params).toEqual(['filename=Q3 deck.pptx'])
  })
  test('bad url, empty values, bad escapes', () => {
    expect(urlHints('nope')).toEqual({ segments: [], params: [] })
    expect(urlHints('https://x.com/%E0%A4%A/a?name=').params).toEqual([])
    expect(urlHints('https://x.com/%E0%A4%A/ab').segments).toEqual(['%E0%A4%A', 'ab'])
  })
  test('at most three params and last three segments', () => {
    const h = urlHints('https://x.com/a1/b1/c1/d1?name=1&title=2&file=3&doc=4')
    expect(h.segments).toEqual(['b1', 'c1', 'd1'])
    expect(h.params.length).toBe(3)
  })
})

describe('pdfInfo', () => {
  test('literal title with escapes and subject', () => {
    const r = pdfInfo(
      bytes(String.raw`1 0 obj<</Title (Acme \(Ltd\) invoice)/Subject(March 2026)>>endobj`)
    )
    expect(r).toEqual({ title: 'Acme (Ltd) invoice', subject: 'March 2026' })
  })
  test('hex UTF-16 title', () => {
    expect(pdfInfo(bytes('<</Title<FEFF00480069>>>')).title).toBe('Hi')
  })
  test('junk and missing titles are dropped', () => {
    expect(pdfInfo(bytes('<</Title(Untitled)>>')).title).toBeUndefined()
    expect(pdfInfo(bytes('<</Title(Microsoft Word - memo.docx)>>')).title).toBeUndefined()
    expect(pdfInfo(bytes('%PDF-1.4 nothing')).title).toBeUndefined()
  })
  test('XMP fallback', () => {
    const r = pdfInfo(
      bytes(
        '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Trip plan</rdf:li></rdf:Alt></dc:title>'
      )
    )
    expect(r.title).toBe('Trip plan')
  })
  test('title is capped', () => {
    expect(pdfInfo(bytes(`<</Title(${'a'.repeat(500)})>>`)).title?.length).toBe(CAPS.meta)
  })
})

describe('pdfText', () => {
  const content =
    'BT /F1 12 Tf (Kyoto rail pass guide for visitors) Tj [(Day ) -300 (one itinerary)] TJ ET'
  test('reads plain and TJ strings from a compressed stream', () => {
    const z = deflateSync(Buffer.from(content)).toString('latin1')
    const pdf = bytes(`<</Filter/FlateDecode/Length ${z.length}>>\nstream\n${z}\nendstream`)
    expect(pdfText(pdf, inflate)).toBe('Kyoto rail pass guide for visitors Day one itinerary')
  })
  test('uncompressed stream', () => {
    expect(pdfText(bytes(`<<>>\nstream\n${content}\nendstream`), inflate)).toContain('Kyoto')
  })
  test('garbage glyph text is dropped', () => {
    const junk =
      'BT (\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15) Tj ET'
    expect(pdfText(bytes(`<<>>\nstream\n${junk}\nendstream`), inflate)).toBe('')
  })
  test('failed inflate and no streams give empty', () => {
    expect(pdfText(bytes('<</Filter/FlateDecode>>\nstream\nnot zlib\nendstream'), inflate)).toBe('')
    expect(pdfText(bytes('hello'), inflate)).toBe('')
  })
})

describe('textSnippet', () => {
  test('csv header is kept, capped', () => {
    const s = textSnippet(bytes('name,amount\n' + 'a,1\n'.repeat(1000)), '.csv')
    expect(s.startsWith('name,amount a,1')).toBe(true)
    expect(s.length).toBeLessThanOrEqual(CAPS.fileText)
  })
  test('html loses tags and scripts, keeps the title', () => {
    const s = textSnippet(
      bytes('<html><title>Annual report</title><script>var x=1</script><body><p>Hello</p></body>'),
      '.html'
    )
    expect(s).toBe('Annual report Hello')
  })
  test('binary and unknown types give nothing', () => {
    expect(textSnippet(bytes('a\u0000b'), '.txt')).toBe('')
    expect(textSnippet(bytes('abc'), '.exe')).toBe('')
  })
})

describe('imageMeta', () => {
  const chunk = (type: string, data: string): string => {
    const len = String.fromCharCode(0, 0, 0, data.length)
    return len + type + data + 'crc!'
  }
  test('reads PNG text chunks', () => {
    const png = bytes(
      '\x89PNG\r\n\x1a\n' + chunk('tEXt', 'Title\u0000Sunset at Lake Como') + chunk('IEND', '')
    )
    expect(imageMeta(png)).toBe('Title: Sunset at Lake Como')
  })
  test('other data gives nothing', () => {
    expect(imageMeta(bytes('GIF89a'))).toBe('')
    expect(imageMeta(bytes('\x89PNG\r\n\x1a\n'))).toBe('')
  })
})

describe('buildFilenamePrompt', () => {
  test('only the evidence there is, each part capped', () => {
    const p = buildFilenamePrompt({
      filename: 'download',
      url: 'https://x.com/get?id=1&name=Acme+invoice',
      host: 'x.com',
      pageTitle: 't'.repeat(1000),
      linkText: 'Download invoice',
      fileText: 'f'.repeat(5000)
    })
    expect(p).toContain('Link text: Download invoice')
    expect(p).toContain('name=Acme invoice')
    expect(p).not.toContain('Page heading')
    expect(p.length).toBeLessThan(2000)
    expect(p).toContain('t'.repeat(CAPS.title))
    expect(p).not.toContain('t'.repeat(CAPS.title + 1))
  })
})

describe('acceptSuggestion', () => {
  test('keeps the original extension', () => {
    expect(acceptSuggestion('Acme invoice 2026-03', 'download.pdf')).toBe(
      'Acme invoice 2026-03.pdf'
    )
  })
  test('rejects null, empty, generic, and near-identical', () => {
    expect(acceptSuggestion(null, 'download.pdf')).toBeNull()
    expect(acceptSuggestion('  ', 'download.pdf')).toBeNull()
    expect(acceptSuggestion('Document', 'a1b2.pdf')).toBeNull()
    expect(acceptSuggestion('IMG_1234', 'x.jpg')).toBeNull()
    expect(acceptSuggestion('Q3 Board Deck', 'q3-board-deck.pptx')).toBeNull()
    expect(acceptSuggestion('q3_board_deck.pptx', 'Q3 board deck.pptx')).toBeNull()
  })
})
