/**
 * Types for the part of Brave's adblock-rs we use (the package ships none). Shapes follow its js/index.js and
 * js/src/lib.rs at 0.13.
 */
declare module 'adblock-rs' {
  export class FilterSet {
    constructor(debug?: boolean)
    addFilters(rules: string | string[], opts?: { permissions?: number }): unknown
  }

  export interface CosmeticResources {
    hide_selectors: string[]
    /** JSON-encoded procedural filters and filters with an action. */
    procedural_actions: string[]
    exceptions: string[]
    injected_script: string
    generichide: boolean
  }

  export interface CheckResult {
    should_block: boolean
    important: boolean
    redirect?: string | null
    rewritten_url?: string | null
  }

  export class Engine {
    constructor(filters: FilterSet)
    check(url: string, sourceUrl: string, type: string, method: string, debug: true): CheckResult
    check(url: string, sourceUrl: string, type: string, method?: string): boolean
    urlCosmeticResources(url: string): CosmeticResources
    hiddenClassIdSelectors(classes: string[], ids: string[], exceptions: string[]): string[]
    serialize(): ArrayBuffer
    /** Swallows errors: a damaged buffer leaves an engine that blocks nothing. */
    deserialize(data: ArrayBuffer): null
    useResources(resources: unknown[]): null
  }

  export function uBlockResources(
    webAccessibleResourceDir: string,
    redirectResourcesPath: string,
    scriptletsPath?: string
  ): unknown[]
}
