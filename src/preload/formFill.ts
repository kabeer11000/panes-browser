import { ipcRenderer } from 'electron'
import {
  addressValue,
  cardValue,
  fieldKind,
  isCardKind,
  type FieldInfo,
  type FieldKind
} from '@shared/formFill'
import type { FormEntry, FormEntrySummary } from '@shared/types'
import { openFillMenu, type FillMenu } from './fillMenu'

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

const SUBMIT_WORDS = /pay|place.?order|continue|submit|save|next|check.?out|confirm|buy/i

const isField = (t: unknown): t is Field =>
  t instanceof HTMLInputElement ||
  t instanceof HTMLSelectElement ||
  t instanceof HTMLTextAreaElement

const visible = (el: HTMLElement): boolean => el.offsetWidth > 0 && el.offsetHeight > 0

function info(el: Field): FieldInfo {
  const label =
    (el.labels?.[0]?.textContent ?? '') ||
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    ''
  return {
    tag: el.tagName.toLowerCase(),
    type: el instanceof HTMLSelectElement ? 'select' : el.type,
    autocomplete: el.getAttribute('autocomplete') ?? '',
    name: el.name,
    id: el.id,
    label: label.trim().slice(0, 100),
    maxLength: el instanceof HTMLSelectElement ? -1 : el.maxLength
  }
}

/** The fields around `el` that autofill knows, with what each asks for. */
function fieldsAround(el: Field): Array<{ el: Field; kind: FieldKind }> {
  return [...(el.form ?? document).querySelectorAll<Field>('input, select, textarea')].flatMap(
    (f) => {
      if (f.disabled || (!(f instanceof HTMLSelectElement) && f.readOnly) || !visible(f)) return []
      const kind = fieldKind(info(f))
      return kind ? [{ el: f, kind }] : []
    }
  )
}

/** A sign-in or sign-up form: the password menu is the one offered there. */
const hasPassword = (el: Field): boolean =>
  !!(el.form ?? document).querySelector('input[type=password]')

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function setValue(el: Field, value: string): void {
  if (el instanceof HTMLSelectElement) {
    // by value or by what it says ("04", "4", "April"; "GB", "United Kingdom")
    const want = norm(value)
    const opt = [...el.options].find(
      (o) =>
        norm(o.value) === want ||
        norm(o.text) === want ||
        (/^\d+$/.test(value) && Number(o.value) === Number(value) && o.value.trim() !== '')
    )
    if (!opt) return
    el.value = opt.value
  } else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Address and card autofill (Chrome's): a field that asks for part of an address or card offers the saved ones; one
 * picked fills that field and the empty ones beside it. A submitted form's address or card is offered for saving
 * (main/formData.ts asks). Never in a sign-in form, where the password menu is offered.
 */
export function installFormFill(): void {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return
  let menu: FillMenu | null = null
  const close = (): void => {
    menu?.close()
    menu = null
  }

  const fill = async (id: number, from: Field): Promise<void> => {
    const entry = (await ipcRenderer.invoke('ff:fill', id)) as FormEntry | null
    close()
    if (!entry) return
    for (const { el, kind } of fieldsAround(from)) {
      if (el !== from && el.value !== '' && !(el instanceof HTMLSelectElement)) continue
      const value =
        entry.kind === 'card'
          ? isCardKind(kind)
            ? cardValue(kind, entry.card, info(el))
            : ''
          : isCardKind(kind)
            ? ''
            : addressValue(kind, entry.address)
      if (value) setValue(el, value)
    }
  }

  const offer = async (target: EventTarget | null): Promise<void> => {
    if (!isField(target) || target === menu?.field || !visible(target)) return
    if (!(target instanceof HTMLSelectElement) && target.value !== '') return
    if (target instanceof HTMLSelectElement || hasPassword(target)) return
    const kind = fieldKind(info(target))
    if (!kind) return
    const rows = (await ipcRenderer.invoke(
      'ff:offers',
      isCardKind(kind) ? 'card' : 'address'
    )) as FormEntrySummary[]
    if (rows.length === 0 || document.activeElement !== target) return
    close()
    menu = openFillMenu(target, rows, (i) => void fill(rows[i].id, target))
  }

  const capture = (scope: ParentNode): void => {
    const first = scope.querySelector?.('input, select, textarea')
    if (!isField(first) || hasPassword(first)) return
    const fields = fieldsAround(first)
      .map(({ el, kind }) => ({
        kind,
        value:
          el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.text ?? el.value) : el.value
      }))
      .filter((f) => f.value.trim())
    if (fields.length >= 2) ipcRenderer.send('ff:submit', fields)
  }

  document.addEventListener('focusin', (e) => void offer(e.target), true)
  document.addEventListener('click', (e) => void offer(e.target), true)
  document.addEventListener('focusout', close, true)
  window.addEventListener('scroll', close, true)
  window.addEventListener('resize', close)
  document.addEventListener(
    'keydown',
    (e) => {
      if (menu?.key(e) && e.key === 'Escape') menu = null
    },
    true
  )
  document.addEventListener('submit', (e) => capture(e.target as ParentNode), true)
  document.addEventListener(
    'click',
    (e) => {
      const button =
        e.target instanceof Element
          ? e.target.closest<HTMLButtonElement>('button, input[type=submit], [role=button]')
          : null
      if (!button) return
      if (button.type === 'submit' || SUBMIT_WORDS.test(button.textContent ?? ''))
        capture(button.form ?? document)
    },
    true
  )
}
