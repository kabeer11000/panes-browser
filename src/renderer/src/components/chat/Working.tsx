/** The assistant at work: what it is doing, shimmering. */
export function Working({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="ai-working" aria-hidden="true">
      <span className="ai-shimmer">{label}</span>
    </div>
  )
}
