/** Sites' icons through the window's own cache (main/favicons.ts): its address there, and back. */

const PREFIX = 'panes-icon://i/'

/** A site's icon as the window should ask for it: web icons through the disk cache, anything else as it is. */
export function cachedIcon(src: string): string {
  return /^https?:\/\//i.test(src) ? PREFIX + encodeURIComponent(src) : src
}

/** The site's icon address a `panes-icon://` request names; null for anything else. */
export function iconAddress(requestUrl: string): string | null {
  if (!requestUrl.startsWith(PREFIX)) return null
  try {
    const url = decodeURIComponent(requestUrl.slice(PREFIX.length).replace(/\/$/, ''))
    return /^https?:\/\/[^\s]+$/i.test(url) && url.length <= 2048 ? url : null
  } catch {
    return null
  }
}

/** What kind of picture the bytes are (icons come as these); null when they are not one. */
export function iconMime(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]): boolean => v.every((x, j) => b[i + j] === x)
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  if (at(4, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66)) return 'image/avif'
  if (at(0, 0x42, 0x4d)) return 'image/bmp'
  // SVG: text that starts (after a BOM, spaces, an XML header or comments) with an <svg element
  const head = new TextDecoder().decode(b.subarray(0, 512)).replace(/^\uFEFF/, '').trimStart()
  if (
    /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)
  )
    return 'image/svg+xml'
  return null
}
