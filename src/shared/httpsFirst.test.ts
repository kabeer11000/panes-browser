import { expect, test } from 'bun:test'
import { hostOf, httpsUpgrade } from './httpsFirst'

test('public http pages are tried over https first', () => {
  expect(httpsUpgrade('http://example.org/a?b=1#c')).toBe('https://example.org/a?b=1#c')
  expect(httpsUpgrade('http://www.neverssl.com/')).toBe('https://www.neverssl.com/')
  expect(httpsUpgrade('http://news.site.co.uk:80/')).toBe('https://news.site.co.uk/')
})

test('local, intranet, odd-port and non-http addresses load as asked', () => {
  for (const url of [
    'https://example.org/',
    'http://localhost:3000/',
    'http://localhost/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://router/',
    'http://printer.local/',
    'http://nas.lan/',
    'http://abc.onion/',
    'http://site.example.org:8080/',
    'file:///C:/a.html',
    'panes://settings',
    'not a url'
  ])
    expect(httpsUpgrade(url)).toBeNull()
})

test('hostOf', () => {
  expect(hostOf('http://a.example.org:81/x')).toBe('a.example.org')
  expect(hostOf('nope')).toBe('')
})
