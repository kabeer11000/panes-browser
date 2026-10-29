import { normalizeOrigin } from './passwords'

export interface LoginRow {
  origin: string
  username: string
  password: string
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

const quote = (f: string): string => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)
export const toCsv = (rows: string[][]): string =>
  rows.map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n'

// Column names used by Chrome, Edge, Firefox, Bitwarden and 1Password exports.
const COLUMNS = {
  url: ['url', 'login_uri', 'website', 'web site', 'origin'],
  username: ['username', 'login_username', 'user', 'login', 'email'],
  password: ['password', 'login_password']
}

/** Logins from a password-manager export. Rows without a usable site or password are skipped. */
export function loginsFromCsv(text: string): { rows: LoginRow[]; skipped: number } {
  const [header, ...body] = parseCsv(text)
  if (!header) return { rows: [], skipped: 0 }
  const names = header.map((h) => h.trim().toLowerCase())
  const col = (keys: string[]): number => names.findIndex((n) => keys.includes(n))
  const [u, n, p] = [col(COLUMNS.url), col(COLUMNS.username), col(COLUMNS.password)]
  if (u === -1 || p === -1) return { rows: [], skipped: body.length }

  const rows: LoginRow[] = []
  let skipped = 0
  for (const r of body) {
    const origin = normalizeOrigin(r[u] ?? '')
    const password = r[p] ?? ''
    if (!origin || !password) skipped++
    else rows.push({ origin, username: n === -1 ? '' : (r[n] ?? ''), password })
  }
  return { rows, skipped }
}

/** Chrome-compatible export (name,url,username,password,note). */
export function loginsToCsv(rows: LoginRow[]): string {
  return toCsv([
    ['name', 'url', 'username', 'password', 'note'],
    ...rows.map((r) => [new URL(r.origin).hostname, r.origin, r.username, r.password, ''])
  ])
}
