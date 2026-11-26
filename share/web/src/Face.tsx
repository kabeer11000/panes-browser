/** Someone's initials on their colour, as on their cursor (Panes' Face). */
export function Face({
  name,
  color,
  size = 22
}: {
  name: string
  color: string
  size?: number
}): React.JSX.Element {
  const initials =
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  return (
    <span
      className="wb-face"
      style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}
      title={name}
    >
      {initials}
    </span>
  )
}
