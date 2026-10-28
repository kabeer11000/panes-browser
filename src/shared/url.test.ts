import { describe, expect, test } from 'bun:test'
import { displayHost, resolveInput } from './url'

const search = (q: string): string => 'https://duckduckgo.com/?q=' + encodeURIComponent(q)

describe('resolveInput', () => {
  test('empty stays empty', () => {
    expect(resolveInput('')).toBe('')
    expect(resolveInput('   ')).toBe('')
  })
  test('domains get https', () => {
    expect(resolveInput('github.com')).toBe('https://github.com')
    expect(resolveInput('github.com/a/b?x=1')).toBe('https://github.com/a/b?x=1')
    expect(resolveInput('sub.example.co.uk:8080/x')).toBe('https://sub.example.co.uk:8080/x')
  })
  test('localhost and IPs get http', () => {
    expect(resolveInput('localhost:3000')).toBe('http://localhost:3000')
    expect(resolveInput('127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x')
  })
  test('explicit allowed schemes pass through', () => {
    expect(resolveInput('https://a.com')).toBe('https://a.com')
    expect(resolveInput('HTTP://a.com')).toBe('HTTP://a.com')
  })
  test('dangerous or unknown schemes become searches', () => {
    expect(resolveInput('javascript://%0Aalert(1)')).toBe(search('javascript://%0Aalert(1)'))
    expect(resolveInput('javascript:alert(1)')).toBe(search('javascript:alert(1)'))
    expect(resolveInput('data://x')).toBe(search('data://x'))
  })
  test('plain text and spaced input are searches', () => {
    expect(resolveInput('cats')).toBe(search('cats'))
    expect(resolveInput('how to cook rice.')).toBe(search('how to cook rice.'))
    expect(resolveInput('a.b c.com')).toBe(search('a.b c.com'))
  })
})

describe('displayHost', () => {
  test('strips www', () => expect(displayHost('https://www.a.com/x')).toBe('a.com'))
  test('keeps port', () => expect(displayHost('http://localhost:3000/')).toBe('localhost:3000'))
  test('falls back to raw', () => expect(displayHost('not a url')).toBe('not a url'))
})
