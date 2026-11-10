// A small reader for the tar format (ustar, with GNU long names), for unpacking a downloaded bundle where the system
// has no tar of its own (early Windows 10). Pure: it lists entries; main writes them. Pax headers are skipped.

export interface TarEntry {
  path: string
  type: 'file' | 'dir'
  data: Uint8Array
  /** Unix permission bits (0o755 for the Tor binary, say). */
  mode: number
}

const text = (b: Uint8Array, from: number, len: number): string => {
  let end = from
  while (end < from + len && b[end] !== 0) end++
  return new TextDecoder().decode(b.subarray(from, end))
}
const octal = (b: Uint8Array, from: number, len: number): number =>
  parseInt(text(b, from, len).trim() || '0', 8) || 0

/**
 * The entries of a tar archive, in order. A path that would leave the folder it is unpacked into (absolute, or with
 * "..") is refused: the whole archive is, as it cannot be trusted.
 */
export function readTar(buf: Uint8Array): TarEntry[] {
  const out: TarEntry[] = []
  let at = 0
  let longName: string | null = null
  while (at + 512 <= buf.length) {
    const head = buf.subarray(at, at + 512)
    if (head.every((x) => x === 0)) break // the end: two empty blocks
    const size = octal(head, 124, 12)
    const kind = String.fromCharCode(head[156] || 48)
    const prefix = text(head, 345, 155)
    let name = longName ?? (prefix ? `${prefix}/${text(head, 0, 100)}` : text(head, 0, 100))
    longName = null
    const data = buf.subarray(at + 512, at + 512 + size)
    at += 512 + Math.ceil(size / 512) * 512
    if (kind === 'L') {
      longName = text(data, 0, data.length)
      continue
    }
    if (kind === 'x' || kind === 'g') continue // pax headers: nothing a plain unpack needs
    name = name.replace(/^\.\//, '')
    if (!name) continue
    if (name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..'))
      throw new Error(`Unsafe path in the archive: ${name}`)
    if (kind === '5')
      out.push({ path: name.replace(/\/$/, ''), type: 'dir', data: new Uint8Array(), mode: 0o755 })
    else if (kind === '0' || kind === '\0' || kind === '7')
      out.push({ path: name, type: 'file', data, mode: octal(head, 100, 8) || 0o644 })
    // links and devices: not in a Tor bundle, skipped
  }
  return out
}
