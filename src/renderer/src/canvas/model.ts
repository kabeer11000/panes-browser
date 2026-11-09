import type { ItemKind, Placement } from '@shared/ai/canvasItems'
import type { PdfSrc } from './pdf'

/** Everything a card needs to draw itself, as plain values so a card only redraws when one of them changes. */
export interface CardModel {
  id: number
  kind: ItemKind | 'pending' | 'private'
  title: string
  site: string
  /** A hero picture, a poster, or the picture itself. */
  image?: string
  text?: string
  /** The snapshot of the page (never of a private tab). */
  snap?: string
  pdf?: PdfSrc
  pages?: number
  /** Shown as a reader card (words and a hero), not as a snapshot. */
  reader: boolean
  /** It can be switched between reader and snapshot. */
  toggle: boolean
  /** The site's icon, for cards that have no picture yet. */
  favicon?: string
  /** The page is still loading (its picture comes when it is done). */
  loading?: boolean
  /** A new tab with nothing in it yet. */
  blank?: boolean
  /** How it was placed on the board (a note, a document, a live page), for cards the prompt made. */
  placement?: Placement
  /** The quiet "Added as ..." chip is showing. */
  chip?: boolean
  tor: boolean
  audible: boolean
  muted: boolean
  ringing: boolean
  current: boolean
  isTab: boolean
  streaming: boolean
}

export const sameModel = (a: CardModel, b: CardModel): boolean => {
  const ka = Object.keys(a) as Array<keyof CardModel>
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    const x = a[k]
    const y = b[k]
    if (x === y) continue
    if (
      k === 'pdf' &&
      x &&
      y &&
      (x as PdfSrc).url === (y as PdfSrc).url &&
      (x as PdfSrc).file === (y as PdfSrc).file
    )
      continue
    return false
  }
  return true
}
