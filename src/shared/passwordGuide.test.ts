import { describe, expect, test } from 'bun:test'
import { guideHtml, guideStatusText } from './passwordGuide'
import { BROWSER_SOURCES } from './importers'

const theme = { scheme: 'dark' as const, vars: { '--accent': '#8b8bff', '--fg': '#fff' } }

describe('password export guide', () => {
  test('every browser Panes can import from has steps', () => {
    for (const b of BROWSER_SOURCES) expect(b.passwordSteps.length).toBeGreaterThanOrEqual(3)
  })
  test('the steps are numbered in order, with Panes taking the file last', () => {
    const html = guideHtml('Google Chrome', ['One', 'Two'], theme)
    const items = [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1])
    expect(items.slice(0, 2)).toEqual(['One', 'Two'])
    expect(items[2]).toContain('Panes brings them in')
  })
  test('text is escaped, and a theme value cannot break out of the style', () => {
    const html = guideHtml('<b>X</b>', ['a "quote" & <tag>'], {
      scheme: 'light',
      vars: { '--fg': 'red;}</style><script>alert(1)</script>', 'bad name': 'x' }
    })
    expect(html).not.toContain('<b>X</b>')
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;')
    expect(html).toContain('a &quot;quote&quot; &amp; &lt;tag&gt;')
    expect(html).not.toContain('alert(1)</script>')
    expect(html).not.toContain('bad name')
  })
  test('status lines', () => {
    expect(guideStatusText({ kind: 'waiting' })).toMatch(/Waiting/)
    expect(guideStatusText({ kind: 'imported', added: 1, deleted: true })).toBe(
      '1 password added, and the file deleted.'
    )
    expect(guideStatusText({ kind: 'imported', added: 1200, deleted: false })).toMatch(
      /^1,200 passwords added\. Delete/
    )
    expect(guideStatusText({ kind: 'imported', added: 0, deleted: true })).toMatch(
      /^No new passwords/
    )
    expect(guideStatusText({ kind: 'timeout' })).toMatch(/Nothing was exported/)
  })
})
