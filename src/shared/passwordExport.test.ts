import { describe, expect, test } from 'bun:test'
import { isBrowserPasswordCsv, looksLikePasswordExport } from './passwordExport'

describe('looksLikePasswordExport', () => {
  test('the browsers’ own export names', () => {
    expect(looksLikePasswordExport('Chrome Passwords.csv')).toBe(true)
    expect(looksLikePasswordExport('Microsoft Edge Passwords.csv')).toBe(true)
    expect(looksLikePasswordExport('logins.csv')).toBe(true)
    expect(looksLikePasswordExport('logins (1).csv')).toBe(true)
    expect(looksLikePasswordExport('Chrome Passwords (2).CSV')).toBe(true)
  })
  test('other files', () => {
    expect(looksLikePasswordExport('logins-backup.csv')).toBe(false)
    expect(looksLikePasswordExport('Chrome Passwords.txt')).toBe(false)
    expect(looksLikePasswordExport('report.csv')).toBe(false)
  })
})

describe('isBrowserPasswordCsv', () => {
  test('Chromium and Firefox headers', () => {
    expect(
      isBrowserPasswordCsv('name,url,username,password,note\r\na,https://a.com,u,p,\r\n')
    ).toBe(true)
    expect(
      isBrowserPasswordCsv(
        '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n'
      )
    ).toBe(true)
    expect(isBrowserPasswordCsv('\uFEFFname,url,username,password\n')).toBe(true)
  })
  test('a spreadsheet that is not an export', () => {
    expect(isBrowserPasswordCsv('team,owner,password\nops,me,hunter2\n')).toBe(false)
    expect(isBrowserPasswordCsv('')).toBe(false)
  })
})
