import { parseInline } from '@shared/noteMarks'

/** Text on the board (a note, a label, a shape) with its **bold**, _italic_ and ~~struck~~ words drawn (shared/noteMarks.ts). */
export function Inline({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {parseInline(text).map((r, i) => {
        let el: React.ReactNode = r.t
        if (r.s) el = <s>{el}</s>
        if (r.i) el = <em>{el}</em>
        if (r.b) el = <strong>{el}</strong>
        return <span key={i}>{el}</span>
      })}
    </>
  )
}
