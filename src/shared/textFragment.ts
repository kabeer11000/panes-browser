/**
 * A link to a page that scrolls to and highlights a piece of its text (a text fragment, `#:~:text=`), as Chrome's
 * "Copy link to highlight". A long selection is named by its first and last few words (`start,end`). Null for
 * anything that is not a web page, or an empty selection.
 */
export function highlightLink(url: string, selection: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const text = selection.replace(/\s+/g, ' ').trim()
  if (!text) return null
  // `-`, `,` and `&` mean something in the directive: always escaped (encodeURIComponent leaves `-` alone)
  const enc = (s: string): string => encodeURIComponent(s).replace(/-/g, '%2D')
  const words = text.split(' ')
  const directive =
    words.length <= 10 && text.length <= 120
      ? enc(text)
      : `${enc(words.slice(0, 5).join(' '))},${enc(words.slice(-5).join(' '))}`
  u.hash = '' // a fragment the page had (or an older highlight) gives way
  return `${u.toString()}#:~:text=${directive}`
}
