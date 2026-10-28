/** Favicon with a letter fallback, shared by history and bookmarks. */
export function Site({
  favicon,
  title,
  url
}: {
  favicon: string | null
  title: string
  url: string
}): React.JSX.Element {
  const letter =
    (title || url)
      .replace(/^https?:\/\/(www\.)?/, '')
      .charAt(0)
      .toUpperCase() || '?'
  return favicon ? (
    <img className="site-icon" src={favicon} alt="" />
  ) : (
    <span className="site-icon letter">{letter}</span>
  )
}
