import type { PanesApi } from '../shared/types'

declare global {
  interface Window {
    api: PanesApi
  }
}
