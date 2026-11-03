import { ipcRenderer, webFrame } from 'electron'
import type { CosmeticStart } from '@shared/adblock'
import {
  applyCompiledSelector,
  compileProceduralSelector,
  type ProceduralSelector
} from './proceduralFilters'

/**
 * The ad blocker's page side, in every http(s) frame at document start (registered in src/main/adblock.ts).
 *
 * Runs the lists' scriptlets in the page's own world before any of its scripts, hides the site's own rules'
 * elements, looks up generic rules for the classes and ids that actually appear (the engine keeps them by
 * class and id so a page only pays for the ones it uses), and applies procedural rules. In Standard mode a
 * generic rule is taken back off any element that turns out to hold the site's own content, as Brave does.
 *
 * Adapted from Brave's content_cosmetic.ts (MPL-2.0); procedural rules run on Brave's own
 * proceduralFilters.ts, unchanged.
 */

const start = ipcRenderer.sendSync('adblock:start') as CosmeticStart | null

if (start) {
  if (start.scriptlet) {
    webFrame
      .executeJavaScript(start.scriptlet)
      .catch((err: unknown) => console.warn('[panes adblock]', err))
  }

  const hideCss = (selectors: Iterable<string>): string =>
    Array.from(selectors, (s) => `${s}{display:none!important}`).join('\n')

  // Author sheets, like the YouTube preload's: a user sheet cannot be taken back out, and Standard mode has to.
  if (start.hide.length) webFrame.insertCSS(hideCss(start.hide))

  // ---- generic rules, by class and id ----

  const seenClasses = new Set<string>()
  const seenIds = new Set<string>()
  let newClasses: string[] = []
  let newIds: string[] = []
  /** Generic selectors in force, and the sheet that holds them. */
  const generic = new Set<string>()
  let genericSheet: string | null = null
  /** Standard mode: selectors still to check for the site's own content, and ones found to hold it. */
  const toCheck = new Set<string>()
  const spared = new Set<string>()

  const restyle = (): void => {
    if (genericSheet) webFrame.removeInsertedCSS(genericSheet)
    genericSheet = generic.size ? webFrame.insertCSS(hideCss(generic)) : null
  }

  const note = (el: Element): void => {
    if (el.id && !seenIds.has(el.id)) {
      seenIds.add(el.id)
      newIds.push(el.id)
    }
    for (const c of el.classList) {
      if (c && !seenClasses.has(c)) {
        seenClasses.add(c)
        newClasses.push(c)
      }
    }
  }

  let asking = false
  const lookup = async (): Promise<void> => {
    if (asking || (!newClasses.length && !newIds.length)) return
    const classes = newClasses
    const ids = newIds
    newClasses = []
    newIds = []
    asking = true
    try {
      const selectors = (await ipcRenderer.invoke(
        'adblock:generic',
        classes,
        ids,
        start.exceptions
      )) as string[]
      let added = false
      for (const s of selectors) {
        if (generic.has(s) || spared.has(s)) continue
        generic.add(s)
        if (start.standard) toCheck.add(s)
        added = true
      }
      if (added) restyle()
      if (start.standard && toCheck.size) later(spareFirstParty)
    } finally {
      asking = false
    }
    void lookup() // classes that appeared while asking
  }

  // ---- Standard mode: give the site's own content back ----

  const isOwnUrl = (url: string): boolean => {
    if (!/^(https?:)?\/\//.test(url)) return true // relative: the site's own
    try {
      const host = new URL(url, location.href).hostname
      return host === start.site || host.endsWith('.' + start.site)
    } catch {
      return false
    }
  }

  /** Brave's test: a subtree holding any of the site's own resources, or none from elsewhere, is the site's. */
  const isOwnSubtree = (root: Element): boolean => {
    let other = false
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const id = el.id
      if (
        id.startsWith('google_ads_iframe_') ||
        id.startsWith('div-gpt-ad') ||
        id.startsWith('adfox_')
      ) {
        return false
      }
      const src = el.getAttribute('src')
      if (src !== null) {
        if (isOwnUrl(src)) return true
        other = true
      }
      const style = el.getAttribute('style')
      if (style && (style.includes('url(') || style.includes('//'))) other = true
      const srcdoc = el.getAttribute('srcdoc')
      if (srcdoc !== null && srcdoc.trim() === '') other = true
    }
    return !other
  }

  /** Real reading text (Brave: 30+ characters and 5+ words), not an "Advertisement" label. */
  const hasText = (el: Element): boolean => {
    if (!(el instanceof HTMLElement)) return false
    let text = el.innerText
    for (const tag of el.querySelectorAll('script,style'))
      text = text.replaceAll((tag as HTMLElement).innerText, '')
    text = text.trim()
    return text.length >= 30 && text.split(/\s+/).filter(Boolean).length >= 5
  }

  const spareFirstParty = (): void => {
    const batch = Array.from(toCheck).slice(0, 60)
    let changed = false
    for (const selector of batch) {
      toCheck.delete(selector)
      let matches: NodeListOf<Element>
      try {
        matches = document.querySelectorAll(selector)
      } catch {
        continue
      }
      for (const el of matches) {
        if (isOwnSubtree(el) || hasText(el)) {
          generic.delete(selector)
          spared.add(selector)
          changed = true
          break
        }
      }
    }
    if (changed) restyle()
    if (toCheck.size) later(spareFirstParty)
  }

  // ---- procedural rules ----

  type Action = { type: 'style' | 'remove-attr' | 'remove-class'; arg: string } | { type: 'remove' }
  const procedural: Array<{ selector: ProceduralSelector; action?: Action }> = []
  for (const json of start.procedural) {
    try {
      procedural.push(JSON.parse(json))
    } catch {
      // a rule the engine accepted but this runner cannot read: skip it, not the page
    }
  }

  const styleAttrs = new Map<string, string>()
  const marker = `pa${Math.random().toString(36).slice(2)}`
  const styleAttr = (style: string): string => {
    let attr = styleAttrs.get(style)
    if (!attr) {
      attr = `${marker}-${styleAttrs.size}`
      styleAttrs.set(style, attr)
      webFrame.insertCSS(`[${attr}]{${style}}`)
    }
    return attr
  }

  const act = (el: Element, action?: Action): void => {
    if (!action) el.setAttribute(styleAttr('display:none!important'), '')
    else if (action.type === 'style') el.setAttribute(styleAttr(action.arg), '')
    else if (action.type === 'remove') el.remove()
    else if (action.type === 'remove-attr') el.removeAttribute(action.arg)
    else if (el.classList.contains(action.arg)) el.classList.remove(action.arg) // remove-class
  }

  const runProcedural = (added?: Element[]): void => {
    for (const { selector, action } of procedural) {
      try {
        let from: Element[]
        let first = 0
        if (added) from = added
        else if (selector[0]?.type === 'css-selector') {
          from = Array.from(document.querySelectorAll(selector[0].arg))
          first = 1
        } else from = Array.from(document.querySelectorAll('*'))
        const rest = selector.slice(first)
        const hits = rest.length
          ? applyCompiledSelector(compileProceduralSelector(rest), from as HTMLElement[])
          : from
        for (const el of hits) act(el, action)
      } catch (err) {
        console.warn('[panes adblock] procedural rule failed', JSON.stringify(selector), err)
      }
    }
  }

  // ---- watching the page ----

  /** Work for when the page is idle, but never more than a second away. */
  const later = (fn: () => void): void => {
    requestIdleCallback(() => fn(), { timeout: 1000 })
  }

  let pendingAdded: Element[] = []
  let scheduled = false
  const flush = (): void => {
    scheduled = false
    if (start.generic) void lookup()
    if (procedural.length && pendingAdded.length) runProcedural(pendingAdded)
    pendingAdded = []
  }

  const begin = (): void => {
    if (start.generic) {
      for (const el of document.querySelectorAll('[id],[class]')) note(el)
      void lookup()
    }
    if (procedural.length) runProcedural()
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') {
          note(m.target as Element)
          continue
        }
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue
          note(node)
          if (start.generic) for (const el of node.querySelectorAll('[id],[class]')) note(el)
          if (procedural.length) pendingAdded.push(node, ...node.querySelectorAll('*'))
        }
      }
      if (!scheduled) {
        scheduled = true
        later(flush)
      }
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributeFilter: ['id', 'class']
    })
  }

  if (start.generic || procedural.length) {
    if (document.documentElement) later(begin)
    else document.addEventListener('DOMContentLoaded', () => later(begin), { once: true })
  }
}
