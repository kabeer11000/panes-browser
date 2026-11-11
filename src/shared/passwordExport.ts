import { parseCsv } from './csv'

// The guided password export (main/passwordExport.ts): which downloaded files are a browser's password export, so
// only those are ever imported and deleted.

/**
 * A downloaded file named like a browser's password export: "Chrome Passwords.csv", "Microsoft Edge Passwords.csv",
 * Firefox's "logins.csv", and the copies a second download makes ("logins (1).csv").
 */
export function looksLikePasswordExport(name: string): boolean {
  if (!/\.csv$/i.test(name)) return false
  return /passwords?/i.test(name) || /^logins(?:\s*\(\d+\))?\.csv$/i.test(name)
}

/**
 * Whether a CSV's header is a browser's password export: Chromium's name,url,username,password,note and Firefox's
 * "url","username","password",... both have url, username and password columns. Anything else (a spreadsheet that
 * happens to be called passwords.csv) is left alone.
 */
export function isBrowserPasswordCsv(text: string): boolean {
  const [header] = parseCsv(text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '')
  if (!header) return false
  const cols = new Set(header.map((h) => h.trim().toLowerCase()))
  return cols.has('url') && cols.has('username') && cols.has('password')
}

/** What a guided export came to: imported (and the file deleted or not), or the watch ran out with nothing found. */
export interface PasswordExportResult {
  sourceId: string | null
  added: number
  skipped: number
  deleted: boolean
  /** Nothing was exported before the watch ended. */
  timedOut?: boolean
}
