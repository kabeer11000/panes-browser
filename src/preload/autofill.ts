import { ipcRenderer } from 'electron'
import { usernameFieldIndex } from '@shared/passwords'
import { openFillMenu, type FillMenu } from './fillMenu'

interface Account {
  id: number
  username: string
}

const TEXTUAL = new Set(['', 'text', 'email', 'tel'])

const SUBMIT_WORDS = /log\s?in|sign\s?in|continue|submit|next/i

const visible = (el: HTMLElement): boolean => el.offsetWidth > 0 && el.offsetHeight > 0

/** Inputs sharing a form (or the whole page, for forms built without one), in document order. */
const fieldsAround = (el: HTMLInputElement): HTMLInputElement[] =>
  [...(el.form ?? document).querySelectorAll('input')].filter(
    (i) => !i.disabled && !i.readOnly && i.type !== 'hidden' && visible(i)
  )

function usernameFor(password: HTMLInputElement): HTMLInputElement | null {
  const fields = fieldsAround(password)
  const at = usernameFieldIndex(
    fields.map((f) => ({ type: f.type, autocomplete: f.autocomplete })),
    fields.indexOf(password)
  )
  return at === -1 ? null : fields[at]
}

const passwordAfter = (user: HTMLInputElement): HTMLInputElement | null => {
  const fields = fieldsAround(user)
  return fields.slice(fields.indexOf(user) + 1).find((f) => f.type === 'password') ?? null
}

/** The login form a focused field belongs to, or null if it is not part of one. */
function loginFields(
  target: HTMLInputElement
): { user: HTMLInputElement | null; password: HTMLInputElement } | null {
  if (target.type === 'password') return { user: usernameFor(target), password: target }
  if (!TEXTUAL.has(target.type)) return null
  const password = passwordAfter(target)
  return password ? { user: target, password } : null
}

const IDENTIFIER_NAME = /user|e-?mail|login|identifier|phone|account/i

/** A field that holds who is signing in: an email box, or one named or marked like a username. */
const looksLikeIdentifier = (el: HTMLInputElement): boolean =>
  TEXTUAL.has(el.type) &&
  (el.type === 'email' ||
    /username|email/.test(el.autocomplete) ||
    IDENTIFIER_NAME.test(`${el.name} ${el.id}`))

let lastIdentifier = ''
/**
 * Sign-in is often two steps: the account first, the password on the next screen (which may be a new
 * page, or the same page with the first field gone). Tell the browser who was named, so the password
 * step can be saved with it.
 */
function noteIdentifier(scope: ParentNode): void {
  const field = [...scope.querySelectorAll('input')].find(
    (i) => i.value.trim() !== '' && visible(i) && looksLikeIdentifier(i)
  )
  const value = field?.value.trim() ?? ''
  if (!value || value === lastIdentifier) return
  lastIdentifier = value
  ipcRenderer.send('pw:identifier', value)
}

// What the user submitted: the last filled password field (a new-password form repeats it) and its username.
function capture(scope: ParentNode): void {
  const filled = [...scope.querySelectorAll('input[type=password]')].filter(
    (i): i is HTMLInputElement => i instanceof HTMLInputElement && i.value !== ''
  )
  const password = filled[filled.length - 1]
  if (!password) return noteIdentifier(scope) // the first step: remember who, for the step that has the password
  ipcRenderer.send('pw:submit', usernameFor(password)?.value ?? '', password.value)
}

function setValue(el: HTMLInputElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Saves logins as they are submitted and offers to fill them when a login field is focused. */
export function installAutofill(): void {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return

  let menu: FillMenu | null = null
  let accounts: Account[] = []

  const close = (): void => {
    menu?.close()
    menu = null
  }

  const fill = async (id: number, field: HTMLInputElement): Promise<void> => {
    const found = loginFields(field)
    const login = (await ipcRenderer.invoke('pw:fill', id)) as {
      username: string
      password: string
    } | null
    close()
    if (!found || !login) return
    if (found.user && login.username) setValue(found.user, login.username)
    setValue(found.password, login.password)
    found.password.focus()
  }

  const open = (field: HTMLInputElement): void => {
    close()
    menu = openFillMenu(
      field,
      accounts.map((a) => ({ label: a.username || 'No username', sub: location.hostname })),
      (i) => void fill(accounts[i].id, field)
    )
  }

  const offer = async (target: EventTarget | null): Promise<void> => {
    if (!(target instanceof HTMLInputElement) || target.value !== '' || !visible(target)) return
    if (target === menu?.field || !loginFields(target)) return
    accounts = (await ipcRenderer.invoke('pw:accounts')) as Account[]
    if (accounts.length > 0 && document.activeElement === target) open(target)
  }

  // Remember the account as it is entered, in case the next screen replaces the field before any submit.
  document.addEventListener(
    'change',
    (e) => {
      if (e.target instanceof HTMLInputElement && looksLikeIdentifier(e.target))
        noteIdentifier(document)
    },
    true
  )
  document.addEventListener('focusin', (e) => void offer(e.target), true)
  document.addEventListener('click', (e) => void offer(e.target), true)
  document.addEventListener('focusout', close, true)
  window.addEventListener('scroll', close, true)
  window.addEventListener('resize', close)

  document.addEventListener(
    'keydown',
    (e) => {
      if (menu) {
        if (menu.key(e) && e.key === 'Escape') menu = null
        return
      }
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
        capture(e.target.form ?? document)
      }
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
      // a "show password" eye is a plain button; only submitting buttons, or formless ones that say so, count
      const submits = button.type === 'submit' || SUBMIT_WORDS.test(button.textContent ?? '')
      if (submits) capture(button.form ?? document)
    },
    true
  )
}
