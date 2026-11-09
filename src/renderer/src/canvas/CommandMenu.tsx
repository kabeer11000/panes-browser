import { useEffect, useMemo, useRef, useState } from 'react'
import { matchCommands } from '@shared/ai/canvasCommands'

export interface Command {
  id: string
  label: string
  /** Other words it answers to. */
  also?: string
  /** A key that does the same, shown on the right. */
  keys?: string
  /** Takes what was typed after the command's words (a preset's topic). */
  run: (rest: string) => void
}

interface Props {
  /** Called once as the menu opens, so the commands see the board as it is then. */
  commands: () => Command[]
  /** Free text with no command for it: ask, or find, as the prompt would. */
  onAsk: (q: string) => void
  onFind: (q: string) => void
  /** The assistant can answer (else the free text only finds). */
  canAsk: boolean
  onClose: () => void
}

/**
 * The command menu over the board (/ or Ctrl+K): type to filter, arrows and Enter to run, Esc to close. Text that is
 * no command can be asked or found from the same box.
 */
export function CommandMenu({
  commands: make,
  onAsk,
  onFind,
  canAsk,
  onClose
}: Props): React.JSX.Element {
  const [commands] = useState(make)
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const list = useMemo(() => {
    const found = matchCommands(q, commands)
    // a preset can take a topic after its name ("trip lisbon in may"): match on the first word too
    const first = q.trim().split(/\s+/)[0] ?? ''
    const takers = q.includes(' ')
      ? matchCommands(first, commands).filter(
          (c) => c.id.startsWith('preset:') && !found.includes(c)
        )
      : []
    return [...found, ...takers]
  }, [q, commands])
  const free = q.trim()
  const rows: Array<{ key: string; label: string; keys?: string; run: () => void }> = [
    ...list.map((c) => ({
      key: c.id,
      label: c.label,
      keys: c.keys,
      run: () => c.run(c.id.startsWith('preset:') ? free.split(/\s+/).slice(1).join(' ') : '')
    })),
    ...(free
      ? [
          ...(canAsk ? [{ key: 'ask', label: `Ask: ${free}`, run: () => onAsk(free) }] : []),
          { key: 'find', label: `Find: ${free}`, run: () => onFind(free) }
        ]
      : [])
  ]
  const pick = Math.min(at, Math.max(0, rows.length - 1))
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [onClose])
  useEffect(() => {
    box.current?.querySelector('.cv-cmd-row.on')?.scrollIntoView({ block: 'nearest' })
  }, [pick])
  const run = (i: number): void => {
    const r = rows[i]
    if (!r) return
    onClose()
    r.run()
  }
  return (
    <div className="cv-cmd" ref={box} role="dialog" aria-label="Commands">
      <input
        autoFocus
        value={q}
        placeholder="Type a command, or something to ask or find"
        aria-label="Command"
        aria-controls="cv-cmd-list"
        aria-activedescendant={rows[pick] ? `cv-cmd-${rows[pick].key}` : undefined}
        spellCheck={false}
        onChange={(e) => {
          setQ(e.currentTarget.value)
          setAt(0)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setAt((pick + 1) % Math.max(1, rows.length))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setAt((pick - 1 + rows.length) % Math.max(1, rows.length))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            run(pick)
          }
        }}
      />
      <div className="cv-cmd-list" id="cv-cmd-list" role="listbox">
        {rows.map((r, i) => (
          <button
            key={r.key}
            id={`cv-cmd-${r.key}`}
            type="button"
            role="option"
            aria-selected={i === pick}
            className={'cv-cmd-row' + (i === pick ? ' on' : '')}
            onPointerMove={() => i !== pick && setAt(i)}
            onClick={() => run(i)}
          >
            <span>{r.label}</span>
            {r.keys && <kbd>{r.keys}</kbd>}
          </button>
        ))}
        {rows.length === 0 && <p className="cv-cmd-empty">No command like that</p>}
      </div>
    </div>
  )
}
