import { useEffect, useRef, useState, type ReactNode } from 'react'
import { APPEARANCE_LIMITS } from '../../../shared/settings'
import { ChevronDownIcon } from '../components/icons'
import type { SliderSpec } from './sliders'

/** Inset rounded list with a small title above and an optional footnote below. */
export function Group({
  title,
  footer,
  id,
  children
}: {
  title?: string
  footer?: string
  id?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="u-section" id={id}>
      {title && <h2>{title}</h2>}
      <div className="u-group">{children}</div>
      {footer && <p className="u-footer">{footer}</p>}
    </section>
  )
}

/** One line in a Group: label and hint on the left, the control on the right (or below when stacked). */
export function Row({
  label,
  hint,
  stacked,
  children
}: {
  label: string
  hint?: string
  stacked?: boolean
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className={'u-row' + (stacked ? ' stacked' : '')}>
      <div className="u-text">
        <div className="u-label">{label}</div>
        {hint && <div className="u-hint">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function Toggle({
  on,
  onChange,
  label
}: {
  on: boolean
  onChange: (v: boolean) => void
  label?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={'toggle' + (on ? ' on' : '')}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  )
}

export interface Option<T> {
  value: T
  label: string
}

/** Pill segmented control, for choices with two or three short options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  label: string
}): React.JSX.Element {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Replaces the OS select popup, which cannot be themed. Arrow keys, Enter, Escape all work. */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  label: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const selected = options.findIndex((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const show = (): void => {
    const r = root.current?.getBoundingClientRect()
    // Not enough room below the control for the list: open it upward instead.
    setUp(!!r && r.bottom + options.length * 36 + 24 > window.innerHeight)
    setActive(Math.max(selected, 0))
    setOpen(true)
  }
  const pick = (i: number): void => {
    onChange(options[i].value)
    setOpen(false)
  }
  const onKey = (e: React.KeyboardEvent): void => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, options.length - 1))
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
    else if (e.key === 'Enter' || e.key === ' ') pick(active)
    else return
    e.preventDefault()
  }

  return (
    <div className="sel" ref={root}>
      <button
        type="button"
        className="sel-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        onBlur={() => setOpen(false)}
      >
        <span>{options[selected]?.label}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <ul className={'sel-list' + (up ? ' up' : '')} role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === selected}
              className={(i === active ? 'active ' : '') + (i === selected ? 'chosen' : '')}
              // mousedown, not click: the button's blur would close the list first.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(i)
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A Row with a filled-track range input and its formatted value. */
export function SliderRow({
  spec,
  value,
  onChange,
  showHint = true
}: {
  spec: SliderSpec
  value: number
  onChange: (v: number) => void
  showHint?: boolean
}): React.JSX.Element {
  const { min, max, step } = APPEARANCE_LIMITS[spec.key]
  return (
    <Row label={spec.label} hint={showHint ? spec.hint : undefined}>
      <div className="slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={spec.label}
          style={{ '--pct': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="slider-value">{spec.format(value)}</span>
      </div>
    </Row>
  )
}

/**
 * What a page shows when it has nothing to list: a soft icon, what this place is for, how to fill it,
 * and a few ghost rows that hint at the list that will be here. Used for both "nothing yet" and "no match".
 */
export function EmptyState({
  icon,
  title,
  children,
  action
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
      <div className="empty-ghosts" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  )
}
