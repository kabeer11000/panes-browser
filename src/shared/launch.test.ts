import { describe, expect, test } from 'bun:test'
import { linksFromArgv } from './launch'

const toUrl = (p: string): string => 'file:///' + p.replace(/\\/g, '/')
const exists = (p: string): boolean => !p.includes('missing')

describe('linksFromArgv', () => {
  test('keeps web links and turns openable files into file addresses', () => {
    expect(
      linksFromArgv(
        ['C:\\Panes\\Panes.exe', 'https://example.com/a?b=1', 'C:\\docs\\paper.pdf'],
        toUrl,
        exists
      )
    ).toEqual(['https://example.com/a?b=1', 'file:///C:/docs/paper.pdf'])
  })

  test('ignores flags, the program, other schemes and files that are not there', () => {
    expect(
      linksFromArgv(
        [
          '--inspect',
          'Panes.exe',
          'javascript:alert(1)',
          'data:text/html,x',
          'C:\\missing.html',
          'notes.txt'
        ],
        toUrl,
        exists
      )
    ).toEqual([])
  })

  test('http links are normalised and broken ones dropped', () => {
    expect(linksFromArgv(['HTTP://Example.com', 'https://'], toUrl, exists)).toEqual([
      'http://example.com/'
    ])
  })

  test('extension matching is case-insensitive', () => {
    expect(linksFromArgv(['page.HTML'], toUrl, exists)).toEqual(['file:///page.HTML'])
  })
})
