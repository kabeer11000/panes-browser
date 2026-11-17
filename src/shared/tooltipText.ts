/** "Pen (P)" → ["Pen", "P"]; "Fit everything (Shift+1); zoom with..." keeps its words. */
export function splitShortcut(text: string): { text: string; keys: string[] } {
  const m = /^(.*\S)\s*\(([^()]{1,16})\)$/.exec(text.trim())
  if (!m) return { text: text.trim(), keys: [] }
  const k = m[2].trim()
  // only things that read as keys: one key, or keys joined by +
  if (
    !/^([A-Za-z0-9]|Ctrl|Shift|Alt|Cmd|Esc|Enter|Tab|Space|Del|F\d{1,2}|[/\\[\]=+\-.,`'])(\+\S+)*$/.test(
      k
    )
  )
    return { text: text.trim(), keys: [] }
  return { text: m[1], keys: k.split('+') }
}
