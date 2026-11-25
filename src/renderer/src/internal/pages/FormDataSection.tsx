import { useEffect, useState } from 'react'
import type { FormEntry } from '@shared/types'
import {
  addressLabel,
  addressSub,
  cardLabel,
  cardSub,
  EMPTY_ADDRESS,
  EMPTY_CARD,
  type Address,
  type Card
} from '@shared/formFill'
import { Group, Row } from '@renderer/internal/ui'

type Draft =
  { id?: number; kind: 'address'; value: Address } | { id?: number; kind: 'card'; value: Card }

const ADDRESS_FIELDS: Array<[keyof Address, string, string]> = [
  ['name', 'Name', 'Ada Lovelace'],
  ['organization', 'Company', ''],
  ['street', 'Street address', '12 St James Square'],
  ['city', 'City', 'London'],
  ['state', 'State or region', ''],
  ['postal', 'Postcode', 'SW1Y 4JH'],
  ['country', 'Country', 'United Kingdom'],
  ['phone', 'Phone', ''],
  ['email', 'Email', '']
]
const CARD_FIELDS: Array<[keyof Card, string, string]> = [
  ['name', 'Name on card', ''],
  ['number', 'Card number', '1234 5678 9012 3456'],
  ['expMonth', 'Expiry month', 'MM'],
  ['expYear', 'Expiry year', 'YYYY']
]

const ARM_MS = 4000

/**
 * Saved addresses and payment cards (main/formData.ts), on the passwords page as Chrome keeps them beside passwords:
 * listed, added, changed and deleted here; pages offer them in their forms.
 */
export function FormDataSection(): React.JSX.Element {
  const api = window.panesInternal
  const [items, setItems] = useState<FormEntry[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [armed, setArmed] = useState<number | null>(null)

  const load = (): void => void api.formDataList().then(setItems)
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps -- load only reads the stable api

  const save = async (): Promise<void> => {
    if (!draft) return
    if (!(await api.formDataSave(draft)))
      return setError(
        draft.kind === 'card'
          ? 'That card number does not look right.'
          : 'Fill in at least one field.'
      )
    setDraft(null)
    setError('')
    load()
  }

  const remove = (id: number): void => {
    if (armed !== id) {
      setArmed(id)
      window.setTimeout(() => setArmed((a) => (a === id ? null : a)), ARM_MS)
      return
    }
    setArmed(null)
    void api.formDataRemove(id).then(load)
  }

  const list = (kind: 'address' | 'card'): React.JSX.Element[] =>
    items.flatMap((e) =>
      e.kind !== kind
        ? []
        : [
            <div key={e.id} className="u-row">
              <div className="u-text">
                <div className="u-label">
                  {e.kind === 'card' ? cardLabel(e.card) : addressLabel(e.address)}
                </div>
                <div className="u-hint">
                  {e.kind === 'card' ? cardSub(e.card) : addressSub(e.address)}
                </div>
              </div>
              <button
                className="int-btn small"
                onClick={() =>
                  setDraft(
                    e.kind === 'card'
                      ? { id: e.id, kind: 'card', value: e.card }
                      : { id: e.id, kind: 'address', value: e.address }
                  )
                }
              >
                Edit
              </button>
              <button className="int-btn small danger" onClick={() => remove(e.id)}>
                {armed === e.id ? 'Click again to delete' : 'Delete'}
              </button>
            </div>
          ]
    )

  const form = (d: Draft): React.JSX.Element => {
    const fields = (d.kind === 'card' ? CARD_FIELDS : ADDRESS_FIELDS) as Array<
      [string, string, string]
    >
    const values = d.value as unknown as Record<string, string>
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Group
          title={(d.id === undefined ? 'New ' : 'Edit ') + (d.kind === 'card' ? 'card' : 'address')}
          footer={error || undefined}
        >
          {fields.map(([key, label, placeholder], i) => (
            <Row key={key} label={label}>
              {key === 'street' ? (
                <textarea
                  className="int-text pw-input"
                  rows={2}
                  placeholder={placeholder}
                  value={values[key]}
                  onChange={(e) =>
                    setDraft({ ...d, value: { ...d.value, [key]: e.target.value } } as Draft)
                  }
                />
              ) : (
                <input
                  className="int-text pw-input"
                  autoFocus={i === 0}
                  autoComplete="off"
                  inputMode={key === 'number' || key.startsWith('exp') ? 'numeric' : undefined}
                  placeholder={placeholder}
                  value={values[key]}
                  onChange={(e) =>
                    setDraft({ ...d, value: { ...d.value, [key]: e.target.value } } as Draft)
                  }
                />
              )}
            </Row>
          ))}
          <div className="u-row center pw-form-actions">
            <button
              type="button"
              className="int-btn"
              onClick={() => {
                setDraft(null)
                setError('')
              }}
            >
              Cancel
            </button>
            <button type="submit" className="int-btn primary">
              Save
            </button>
          </div>
        </Group>
      </form>
    )
  }

  const section = (kind: 'address' | 'card', title: string, empty: string): React.JSX.Element => {
    const rows = list(kind)
    return (
      <Group title={title}>
        {rows.length ? rows : <div className="u-row u-hint">{empty}</div>}
        <button
          type="button"
          className="u-row tap"
          onClick={() =>
            setDraft(
              kind === 'card'
                ? { kind: 'card', value: { ...EMPTY_CARD } }
                : { kind: 'address', value: { ...EMPTY_ADDRESS } }
            )
          }
        >
          <div className="u-text">
            <div className="u-label">{kind === 'card' ? 'Add card' : 'Add address'}</div>
          </div>
        </button>
      </Group>
    )
  }

  return (
    <>
      {draft && form(draft)}
      {section(
        'address',
        'Addresses',
        'Fill in an address on a site and Panes will offer to save it.'
      )}
      {section(
        'card',
        'Payment cards',
        'Pay on a site and Panes will offer to save the card, never its security code.'
      )}
    </>
  )
}
