import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { PermKind } from '../../../shared/permissions'
import { CameraIcon, MicIcon, ScreenIcon } from '../components/icons'

export function Switch({
  on,
  label,
  disabled,
  onChange
}: {
  on: boolean
  label: string
  disabled?: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={'pn-switch' + (on ? ' on' : '')}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  )
}

export interface Choice<T extends string> {
  id: T
  label: string
}

/**
 * A row of mutually exclusive choices: one tab stop, arrows move and choose (the radio group pattern). The
 * highlight is one element slid with a transform, so changing the choice costs no layout.
 */
export function Segmented<T extends string>({
  label,
  value,
  choices,
  tone,
  onChange
}: {
  label: string
  value: T
  choices: readonly Choice<T>[]
  /** Colours the chosen one: a block reads as a block at a glance. */
  tone?: (id: T) => 'good' | 'bad' | undefined
  onChange: (v: T) => void
}): React.JSX.Element {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const at = Math.max(
    0,
    choices.findIndex((c) => c.id === value)
  )
  const move = (e: KeyboardEvent): void => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    const to =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? choices.length - 1
          : step === undefined
            ? -1
            : (at + step + choices.length) % choices.length
    if (to < 0) return
    e.preventDefault()
    refs.current[to]?.focus()
    if (choices[to].id !== value) onChange(choices[to].id)
  }
  return (
    <div
      className="pn-seg"
      role="radiogroup"
      aria-label={label}
      data-tone={tone?.(value) ?? ''}
      style={{ ['--n' as string]: choices.length, ['--at' as string]: at }}
      onKeyDown={move}
    >
      <i aria-hidden="true" />
      {choices.map((c, i) => (
        <button
          key={c.id}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={c.id === value}
          tabIndex={c.id === value ? 0 : -1}
          className={c.id === value ? 'on' : ''}
          onClick={() => c.id !== value && onChange(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}

/** One setting: what it is (with a line of detail) on the left, its control on the right. */
export function Row({
  icon,
  title,
  hint,
  hintTone,
  children
}: {
  icon?: ReactNode
  title: ReactNode
  hint?: ReactNode
  hintTone?: 'live' | 'warn'
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="pn-row">
      {icon && <span className="pn-row-icon">{icon}</span>}
      <span className="pn-row-text">
        <span className="pn-row-title">{title}</span>
        {hint && <span className={'pn-row-hint' + (hintTone ? ' ' + hintTone : '')}>{hint}</span>}
      </span>
      {children}
    </div>
  )
}

export function Section({
  title,
  aside,
  children
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="pn-section" aria-label={title}>
      <header>
        <h2>{title}</h2>
        {aside}
      </header>
      <div className="pn-group">{children}</div>
    </section>
  )
}

function Glyph({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** The mark for a kind of access, beside its row. */
export function PermIcon({ kind }: { kind: PermKind }): React.JSX.Element {
  const Icon = PERM_ICON[kind]
  return <Icon />
}

const PERM_ICON: Record<PermKind, () => React.JSX.Element> = {
  camera: CameraIcon,
  microphone: MicIcon,
  screen: ScreenIcon,
  location: () => (
    <Glyph>
      <path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14Z" />
      <circle cx="8" cy="6.5" r="1.6" />
    </Glyph>
  ),
  notifications: () => (
    <Glyph>
      <path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3L4 11ZM6.5 14h3" />
    </Glyph>
  ),
  clipboard: () => (
    <Glyph>
      <rect x="3.5" y="3" width="9" height="11" rx="1.5" />
      <path d="M6 3V2h4v1M6 7h4M6 10h3" />
    </Glyph>
  ),
  midi: () => (
    <Glyph>
      <rect x="2" y="4" width="12" height="8" rx="1.5" />
      <path d="M5.5 4v4.5M8 4v4.5M10.5 4v4.5" />
    </Glyph>
  ),
  windows: () => (
    <Glyph>
      <rect x="1.8" y="3" width="7.5" height="6" rx="1" />
      <rect x="6.7" y="7" width="7.5" height="6" rx="1" />
    </Glyph>
  )
}

export function LockGlyph({ open }: { open?: boolean }): React.JSX.Element {
  return (
    <Glyph>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" />
      <path d={open ? 'M5.5 7V5.2a2.5 2.5 0 0 1 4.6-1.4' : 'M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7'} />
    </Glyph>
  )
}
