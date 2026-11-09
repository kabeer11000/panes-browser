const NAME_MAX = 80
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
const GENERIC_WORDS = new Set([
  'download',
  'downloads',
  'file',
  'document',
  'doc',
  'image',
  'images',
  'img',
  'untitled',
  'unnamed',
  'attachment',
  'unknown',
  'index',
  'export',
  'output',
  'data',
  'blob',
  'photo',
  'picture',
  'scan'
])

/** "name.ext" split at the last dot; a leading dot is part of the name. */
export function splitExt(filename: string): { stem: string; ext: string } {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0 || filename.length - dot > 12) return { stem: filename, ext: '' }
  return { stem: filename.slice(0, dot), ext: filename.slice(dot) }
}

/**
 * Whether a file name says nothing about the file, so a better one is worth suggesting: "download", "image (2)",
 * a UUID, a hash or base64 blob, IMG_1234, or three characters or fewer.
 */
export function isGeneric(filename: string): boolean {
  const stem = splitExt(filename)
    .stem.trim()
    .replace(/\s*\(\d+\)$/, '')
    .trim()
  if (stem.length <= 3) return true
  if (UUID.test(stem)) return true
  if (GENERIC_WORDS.has(stem.toLowerCase())) return true
  if (/^(img|dsc|pxl|mvimg|vid|screenshot|image|photo|scan)[ _-]?\d{3,}$/i.test(stem)) return true
  if (/^\d+$/.test(stem)) return true
  // a hash or an encoded blob: long, no spaces, hex or base64 characters
  if (/^[0-9a-f]{16,}$/i.test(stem)) return true
  return (
    stem.length >= 20 &&
    /^[A-Za-z0-9+/_=-]+$/.test(stem) &&
    /\d/.test(stem) &&
    /[A-Z]/.test(stem) &&
    /[a-z]/.test(stem)
  )
}

/**
 * A file name from a model, made safe: no separators or traversal, control characters, characters Windows
 * refuses, reserved device names or trailing dots and spaces; at most NAME_MAX characters before the extension,
 * which is the download's own (`originalExt`, with its dot, or empty) and is never changed or doubled.
 * Null when nothing is left.
 */
export function sanitize(suggested: string, originalExt: string): string | null {
  let s = suggested.normalize('NFC')
  s = s.replace(/\p{Cc}/gu, ' ')
  s = s.replace(/[/\x5c]+/g, ' ') // slash and backslash
  s = s.replace(/\.{2,}/g, ' ')
  s = s.replace(/[<>:"|?*]/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  if (originalExt && s.toLowerCase().endsWith(originalExt.toLowerCase())) {
    s = s.slice(0, s.length - originalExt.length)
  }
  s = s.replace(/^[. ]+|[. ]+$/g, '')
  if (!s) return null
  if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX).replace(/[. ]+$/, '')
  // Windows reserves "nul.txt" too: the part before the first dot is what counts
  const dot = s.includes('.') ? s.indexOf('.') : s.length
  if (RESERVED.test(s.slice(0, dot))) s = s.slice(0, dot) + '_' + s.slice(dot)
  return s + originalExt
}
