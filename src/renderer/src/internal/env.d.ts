import type { InternalApi } from '../../../shared/types'

declare global {
  interface Window {
    panesInternal: InternalApi
  }
}
