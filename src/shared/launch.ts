/** File types Panes opens when the system hands it a file (it is a browser: pages and documents). */
export const OPENABLE_EXTENSIONS = [
  'html',
  'htm',
  'xhtml',
  'shtml',
  'pdf',
  'svg',
  'webp',
  'avif'
] as const

const extensionOf = (path: string): string => path.slice(path.lastIndexOf('.') + 1).toLowerCase()

/**
 * The addresses to open from a command line: web links as they are, and the files Panes can show turned
 * into file addresses, and a shared space's panes://join invite. Everything else is ignored (flags, the program itself, other schemes), so a
 * crafted argument cannot make Panes open anything it should not.
 */
export function linksFromArgv(
  argv: readonly string[],
  toFileUrl: (path: string) => string,
  isFile: (path: string) => boolean
): string[] {
  const out: string[] = []
  for (const arg of argv) {
    if (!arg || arg.startsWith('-')) continue
    // a shared space's invite, handed over by the system (the invite page's Open in Panes): only that one address
    // of panes://, never an internal page
    if (/^panes:\/\/join\/[A-Za-z0-9_-]{16,64}#[A-Za-z0-9_-]{43}$/.test(arg)) out.push(arg)
    else if (/^https?:\/\//i.test(arg)) {
      try {
        out.push(new URL(arg).toString())
      } catch {
        // not a real address: skip it
      }
    } else if (
      (OPENABLE_EXTENSIONS as readonly string[]).includes(extensionOf(arg)) &&
      isFile(arg)
    ) {
      out.push(toFileUrl(arg))
    }
  }
  return out
}
