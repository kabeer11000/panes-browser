import type { WebContents } from 'electron'
import { siteSearchUrl } from '@shared/ai/sites'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { jsonSchema, tool, type ToolSet } from 'ai'
import type { JSONSchema7 } from 'ai'
import { canShareTab } from '@shared/ai/policy'
import {
  AUTOMATION,
  CLOUD_TOOL_CAP,
  LOCAL_TOOL_CAP,
  MAX_OPEN,
  toolsFor,
  validateToolInput,
  wrapPage,
  type ChatMode,
  type ToolInput,
  type ToolName
} from '@shared/ai/chatTools'
import { needsConfirm } from '@shared/ai/automation'
import { looksLikePdf, wrapDoc } from '@shared/ai/docs'
import type { ToolPart } from '@shared/ai/chatConv'
import type { AiSettings } from '@shared/ai/types'
import type { DownloadInfo } from '@shared/types'
import type { LocalSuggestion } from '@shared/search'
import { displayHost } from '@shared/url'
import * as auto from './automation'
import { bytesText, fileText } from './docText'

export interface ChatTab {
  id: number
  url: string
  title: string
  active: boolean
  private: boolean
  tor: boolean
  /** Playing sound now (which tab "pause the video" means). */
  audible?: boolean
  wc: WebContents | null
}

/** What the tools need from the browser, so they can be tried without it. */
export interface ChatHost {
  tabs: () => ChatTab[]
  settings: () => AiSettings
  history: (query: string, limit: number) => Array<{ url: string; title: string }>
  semantic: (query: string, exclude: string[]) => Promise<LocalSuggestion[]>
  open: (url: string) => void
  activate: (id: number) => void
  close: (id: number) => void
  find: (text: string) => void
  downloads: () => DownloadInfo[]
  /** A web search read in a hidden page. */
  searchWeb: (query: string) => Promise<Array<{ url: string; title: string; snippet: string }>>
  /** The person's search engine address (the words go on its end), for a site with no search page of its own. */
  searchUrl?: () => string
  /** A page's readable text, loaded in a hidden page that is destroyed after. */
  readHidden: (url: string, cap: number) => Promise<{ title: string; text: string } | null>
  /** The bytes behind an address, in the normal session (for PDFs). */
  fetchBytes: (url: string) => Promise<{ mime: string; data: Uint8Array } | null>
}

const READ_TIMEOUT_MS = 3000

/** A fixed script, run in the page: the readable text and nothing a model said ever runs there. */
const readScript = (cap: number): string =>
  `(() => { if (document.contentType === 'application/pdf') return { pdf: true }; const r = document.querySelector('main,article') || document.body; const t = String((r && r.innerText) || ''); return { text: t.length < 400 && document.body ? String(document.body.innerText || '').slice(0, ${cap}) : t.slice(0, ${cap}) } })()`

/** The tabs a model may see: normal ones only. A private or Tor tab is not in the list and has no id it can use. */
export function visibleTabs(host: ChatHost): ChatTab[] {
  const s = host.settings()
  return host.tabs().filter((t) => canShareTab('chat', { private: t.private, tor: t.tor }, s))
}

/** PDFs read in this session, by address: reading one again (a follow-up question) is instant. */
const pdfCache = new Map<string, { text: string; pages: number; cut: boolean }>()
const PDF_CACHE_MAX = 12

async function pdfAt(
  host: ChatHost,
  url: string,
  cap: number
): Promise<{ text: string; pages: number; cut: boolean } | null> {
  const key = `${cap}\n${url}`
  const hit = pdfCache.get(key)
  if (hit) return hit
  let data: Uint8Array | null = null
  if (/^file:/i.test(url)) {
    try {
      data = new Uint8Array(await readFile(fileURLToPath(url)))
    } catch {
      data = null
    }
  } else if (/^https?:/i.test(url)) data = (await host.fetchBytes(url))?.data ?? null
  if (!data) return null
  const doc = await bytesText('document.pdf', data, cap, 'pdf')
  if (!doc) return null
  const v = { text: doc.text, pages: doc.pages, cut: doc.cut }
  pdfCache.set(key, v)
  while (pdfCache.size > PDF_CACHE_MAX) pdfCache.delete(pdfCache.keys().next().value as string)
  return v
}

/**
 * The text of a visible tab, cut to cap characters: a web page's words, or a PDF's (pdf.js, page by page). Null when
 * it is not visible or not loaded.
 */
export async function readTabText(
  host: ChatHost,
  id: number,
  cap: number
): Promise<{ text: string; pdf?: { pages: number; cut: boolean } } | null> {
  const t = visibleTabs(host).find((x) => x.id === id)
  if (!t) return null
  if (looksLikePdf(t.url) || /^file:.*\.pdf$/i.test(t.url)) {
    const p = await pdfAt(host, t.url, cap)
    if (p) return { text: p.text, pdf: { pages: p.pages, cut: p.cut } }
  }
  if (!t.wc || t.wc.isDestroyed()) return null
  try {
    const got = (await Promise.race([
      t.wc.executeJavaScript(readScript(cap), true) as Promise<unknown>,
      new Promise<null>((r) => setTimeout(() => r(null), READ_TIMEOUT_MS))
    ])) as { pdf?: boolean; text?: unknown } | null
    if (got?.pdf) {
      const p = await pdfAt(host, t.url, cap)
      return p ? { text: p.text, pdf: { pages: p.pages, cut: p.cut } } : null
    }
    return typeof got?.text === 'string' ? { text: got.text } : null
  } catch {
    return null
  }
}

/** A tab's text wrapped for the model: a <document> for a PDF, a <page> for a web page. */
export function wrapTab(
  t: ChatTab,
  r: NonNullable<Awaited<ReturnType<typeof readTabText>>>,
  cap: number
): string {
  if (r.pdf)
    return wrapDoc(
      {
        name: `${t.title || displayHost(t.url) || 'PDF'} (tab ${t.id}, ${t.url})`,
        pages: r.pdf.pages,
        text: r.text,
        cut: r.pdf.cut
      },
      cap
    )
  return wrapPage({ tabId: t.id, title: t.title, url: t.url, text: r.text }, cap)
}

export interface ToolEnv {
  host: ChatHost
  weak: boolean
  mode: ChatMode
  emit: (part: ToolPart) => void
  /** Ask the person; resolves true on Confirm. The card is shown by the panel. */
  confirm: (part: ToolPart) => Promise<boolean>
  newId: () => string
  /** Per turn: how many tabs were opened, which tab automation brought forward. */
  turn: { opened: number; shown: Set<number> }
}

const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}...` : s)
const label = (t: ChatTab): string => short(t.title || displayHost(t.url) || t.url || 'New tab', 60)

/** The AI SDK tool set for this turn: only what the model may use, each call checked, shown and run here. */
export function buildTools(env: ToolEnv): ToolSet {
  const out: ToolSet = {}
  const cap = env.weak ? LOCAL_TOOL_CAP : CLOUD_TOOL_CAP
  for (const spec of toolsFor(env.weak, env.mode)) {
    out[spec.name] = tool({
      description: spec.description,
      inputSchema: jsonSchema(spec.schema as JSONSchema7),
      execute: async (input: unknown) => {
        const part: ToolPart = {
          type: 'tool',
          id: env.newId(),
          name: spec.name,
          state: 'running',
          detail: ''
        }
        const finish = (state: ToolPart['state'], detail: string, result: string): string => {
          env.emit({ ...part, state, detail })
          return result
        }
        const current = visibleTabs(env.host).find((t) => t.active)?.id
        const v = validateToolInput(spec.name, input, current)
        if (!v.ok) return finish('error', v.error, `Error: ${v.error}`)
        env.emit(part)
        try {
          return await run(env, v.value, part, cap, finish)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'failed'
          return finish('error', short(msg, 100), `Error: ${msg}`)
        }
      }
    })
  }
  return out
}

type Finish = (state: ToolPart['state'], detail: string, result: string) => string

/** A made-up or stale tab id: the real ones come back with the error, so the model can retry at once. */
const gone = (id: number, tabs: ChatTab[]): string =>
  `Error: there is no open tab with id ${id}. Leave tabId out for the current tab, or use one of these: ${tabs
    .slice(0, 12)
    .map(
      (t) =>
        `${t.id} (${short(t.title || displayHost(t.url) || 'Untitled', 40)}${t.active ? ', current' : ''})`
    )
    .join(', ')}.`

const when = (t: number): string => new Date(t).toISOString().slice(0, 16).replace('T', ' ')

/**
 * The tab an automation step works on, loaded and in front so the person sees what happens. An unloaded tab is
 * woken first.
 */
async function liveTab(env: ToolEnv, id: number): Promise<ChatTab | null> {
  const find = (): ChatTab | undefined => visibleTabs(env.host).find((t) => t.id === id)
  let t = find()
  if (!t) return null
  if (!t.active || !env.turn.shown.has(id)) {
    if (!t.active) env.host.activate(id)
    env.turn.shown.add(id)
  }
  for (let i = 0; i < 40 && (!t?.wc || t.wc.isDestroyed()); i++) {
    await new Promise((r) => setTimeout(r, 200))
    t = find()
  }
  if (!t?.wc) return null
  if (t.wc.isLoading())
    await Promise.race([
      new Promise<void>((r) => t?.wc?.once('did-stop-loading', () => r())),
      new Promise((r) => setTimeout(r, 8000))
    ])
  return t
}

async function run(
  env: ToolEnv,
  v: ToolInput,
  part: ToolPart,
  cap: number,
  finish: Finish
): Promise<string> {
  const { host } = env
  const tabs = visibleTabs(host)
  const find = (id: number): ChatTab | undefined => tabs.find((t) => t.id === id)
  const lookCap = Math.min(cap, 3000)

  if (AUTOMATION.has(v.name) && 'tabId' in v) {
    if (!find(v.tabId)) return finish('error', 'No such tab', gone(v.tabId, tabs))
  }

  switch (v.name) {
    case 'list_tabs': {
      const lines = tabs.map(
        (t) =>
          `id=${t.id} | ${short(t.title || '(untitled)', 80)} | ${short(t.url || 'blank', 120)}${t.active ? ' | active' : ''}`
      )
      return finish('done', `${tabs.length} tabs`, lines.join('\n') || 'There are no open tabs.')
    }
    case 'read_tab': {
      const t = find(v.tabId)
      if (!t) return finish('error', 'No such tab', gone(v.tabId, tabs))
      const r = await readTabText(host, t.id, cap)
      if (r === null)
        return finish(
          'done',
          label(t),
          `Tab ${t.id} (${t.title}, ${t.url}) is not loaded, so its text cannot be read. Switch to it first.`
        )
      return finish('done', label(t), wrapTab(t, r, cap))
    }
    case 'search_history': {
      const text = host.history(v.query, 8)
      const seen = new Set(text.map((h) => h.url))
      const meaning = host.settings().semanticHistory ? await host.semantic(v.query, [...seen]) : []
      const all = [...text, ...meaning.map((m) => ({ url: m.url, title: m.title }))].slice(0, 10)
      const lines = all.map((h) => `${short(h.title || '(untitled)', 80)} | ${short(h.url, 120)}`)
      return finish(
        'done',
        `"${short(v.query, 40)}"`,
        lines.join('\n') || 'Nothing in history matches.'
      )
    }
    case 'list_downloads': {
      const words = v.query.toLowerCase().split(/\s+/).filter(Boolean)
      const list = host
        .downloads()
        .filter((d) => d.state === 'completed' && !d.missing)
        .filter((d) => words.every((w) => d.filename.toLowerCase().includes(w)))
        .sort((a, b) => b.time - a.time)
        .slice(0, 25)
      const lines = list.map(
        (d) =>
          `id=${d.id} | ${short(d.filename, 100)} | ${when(d.time)} | from ${short(displayHost(d.url) || d.url, 60)}`
      )
      return finish(
        'done',
        v.query ? `"${short(v.query, 40)}"` : `${list.length} files`,
        lines.join('\n') || 'No finished downloads match.'
      )
    }
    case 'read_download': {
      const d = host.downloads().find((x) => x.id === v.downloadId && x.state === 'completed')
      if (!d) return finish('error', 'No such file', 'Error: no finished download has that id.')
      const doc = await fileText(d.savePath, cap)
      if (!doc)
        return finish(
          'error',
          short(d.filename, 60),
          `Error: ${d.filename} is not a PDF or text file that can be read, or it is gone.`
        )
      return finish('done', short(d.filename, 60), wrapDoc(doc, cap))
    }
    case 'search_web': {
      const res = await host.searchWeb(v.query)
      const lines = res.map(
        (r, i) => `${i + 1}. ${short(r.title, 120)}\n   ${r.url}\n   ${short(r.snippet, 220)}`
      )
      return finish(
        'done',
        `"${short(v.query, 40)}"`,
        res.length
          ? `<page title="Web results for ${v.query.replace(/["<>]/g, ' ')}">\n${lines.join('\n')}\n</page>`
          : 'The search returned nothing. Try other words.'
      )
    }
    case 'read_web_page': {
      const host_ = displayHost(v.url) || v.url
      if (looksLikePdf(v.url)) {
        const p = await pdfAt(host, v.url, cap)
        if (p)
          return finish(
            'done',
            short(host_, 60),
            wrapDoc({ name: v.url, pages: p.pages, text: p.text, cut: p.cut }, cap)
          )
      }
      const r = await host.readHidden(v.url, cap)
      if (r && r.text.trim())
        return finish(
          'done',
          short(r.title || host_, 60),
          wrapPage({ tabId: 0, title: r.title, url: v.url, text: r.text }, cap)
        )
      // not a page that loads: it may be a PDF behind an address that does not say so
      const p = await pdfAt(host, v.url, cap)
      if (p)
        return finish(
          'done',
          short(host_, 60),
          wrapDoc({ name: v.url, pages: p.pages, text: p.text, cut: p.cut }, cap)
        )
      return finish('error', short(host_, 60), `Error: ${v.url} could not be read.`)
    }
    case 'open_tab':
      if (env.turn.opened >= MAX_OPEN)
        return finish(
          'denied',
          'Too many tabs',
          `Not opened: at most ${MAX_OPEN} tabs per answer. List the other links in your answer instead.`
        )
      env.turn.opened++
      host.open(v.url)
      return finish('done', displayHost(v.url) || v.url, `Opened ${v.url} in a new tab.`)
    case 'search_on_site': {
      if (env.turn.opened >= MAX_OPEN)
        return finish(
          'denied',
          'Too many tabs',
          `Not opened: at most ${MAX_OPEN} tabs per answer. List the other links in your answer instead.`
        )
      const s = siteSearchUrl(v.site, v.query, host.searchUrl?.())
      env.turn.opened++
      host.open(s.url)
      return finish(
        'done',
        `${s.name}: ${short(v.query, 40)}`,
        `Opened a ${s.name} search for "${v.query}" in a new tab (${s.url}). It is on screen now.`
      )
    }
    case 'switch_to_tab': {
      const t = find(v.tabId)
      if (!t) return finish('error', 'No such tab', gone(v.tabId, tabs))
      host.activate(t.id)
      return finish('done', label(t), `Switched to tab ${t.id}.`)
    }
    case 'find_in_page': {
      const t = find(v.tabId)
      if (!t) return finish('error', 'No such tab', gone(v.tabId, tabs))
      host.activate(t.id)
      host.find(v.text)
      return finish(
        'done',
        `"${short(v.text, 40)}" on ${label(t)}`,
        `Highlighted "${v.text}" on tab ${t.id}.`
      )
    }
    case 'close_tabs': {
      const targets = v.tabIds.map((id) => find(id)).filter((t): t is ChatTab => !!t)
      if (targets.length === 0)
        return finish('error', 'No such tabs', 'Error: none of those tabs are open.')
      const names = targets.map(label).join(', ')
      const ok = await env.confirm({
        ...part,
        state: 'confirm',
        detail: `Close ${targets.length} ${targets.length === 1 ? 'tab' : 'tabs'}: ${names}`
      })
      if (!ok)
        return finish(
          'denied',
          'Not closed',
          'The person chose not to close these tabs. Do not ask again.'
        )
      // the list may have moved while the card was open: close only what is still a visible tab
      const still = new Set(visibleTabs(host).map((t) => t.id))
      for (const t of targets) if (still.has(t.id)) host.close(t.id)
      return finish('done', `Closed ${targets.length}`, `Closed ${targets.length} tabs: ${names}.`)
    }

    // ---- driving a tab ----
    case 'look_at_page': {
      const t = await liveTab(env, v.tabId)
      if (!t?.wc) return finish('error', 'Not loaded', 'Error: the tab could not be loaded.')
      return finish('done', label(t), await auto.look(t.wc, lookCap))
    }
    case 'navigate': {
      const t = await liveTab(env, v.tabId)
      if (!t?.wc) return finish('error', 'Not loaded', 'Error: the tab could not be loaded.')
      await auto.navigate(t.wc, v.url)
      return finish('done', displayHost(v.url) || v.url, await auto.look(t.wc, lookCap))
    }
    case 'go_back': {
      const t = await liveTab(env, v.tabId)
      if (!t?.wc) return finish('error', 'Not loaded', 'Error: the tab could not be loaded.')
      if (!(await auto.back(t.wc)))
        return finish('error', label(t), 'Error: there is no page to go back to.')
      return finish('done', label(t), await auto.look(t.wc, lookCap))
    }
    case 'scroll_page': {
      const t = await liveTab(env, v.tabId)
      if (!t?.wc) return finish('error', 'Not loaded', 'Error: the tab could not be loaded.')
      await auto.scroll(t.wc, v.direction)
      return finish('done', v.direction, await auto.look(t.wc, lookCap))
    }
    case 'scroll_to': {
      const t = await liveTab(env, v.tabId)
      if (!t?.wc) return finish('error', 'Not loaded', 'Error: the tab could not be loaded.')
      const at = await auto.scrollTo(t.wc, v.target)
      if (!at)
        return finish(
          'error',
          short(v.target, 40),
          `Error: nothing on the page matches "${v.target}". Try look_at_page to see what is there.`
        )
      return finish('done', short(at, 40), await auto.look(t.wc, lookCap))
    }
    case 'media_control': {
      const t = await liveTab(env, v.tabId)
      if (!t?.wc) return finish('error', 'Not loaded', 'Error: the tab could not be loaded.')
      const m = await auto.media(t.wc, v.action, v.amount)
      if (!m)
        return finish(
          'error',
          'No video',
          'Error: there is no video or audio on this page to control.'
        )
      const state = `${m.paused ? 'paused' : 'playing'}${m.muted ? ', muted' : ''} at ${m.time}s${
        m.duration ? ` of ${m.duration}s` : ''
      }, speed ${m.rate}`
      return finish('done', `${v.action}: ${state}`, `Done: ${state}.`)
    }
    case 'press_key': {
      const t = await liveTab(env, v.tabId)
      if (!t?.wc) return finish('error', 'Not loaded', 'Error: the tab could not be loaded.')
      await auto.press(t.wc, v.key)
      return finish('done', v.key, await auto.look(t.wc, lookCap))
    }
    case 'click':
    case 'type_text':
    case 'select_option': {
      const t = await liveTab(env, v.tabId)
      if (!t?.wc) return finish('error', 'Not loaded', 'Error: the tab could not be loaded.')
      const a = await auto.aim(t.wc, v.ref)
      if (!a)
        return finish(
          'error',
          `Control ${v.ref} not found`,
          `Error: there is no control ${v.ref} on the page now. Call look_at_page again for fresh numbers.`
        )
      const what = short(a.name || a.role, 50)
      const site = displayHost(t.url) || 'this page'
      if (v.name === 'type_text') {
        if (a.password || (a.sensitiveForm && /card|cvv|cvc|password/i.test(a.name)))
          return finish(
            'denied',
            'Left for you',
            'Not typed: passwords and payment details are typed by the person. Ask them to fill this in, then continue.'
          )
        if (!a.editable)
          return finish('error', what, `Error: control ${v.ref} (${a.role}) is not a text field.`)
        if (v.submit && needsConfirm(a, 'submit')) {
          const ok = await env.confirm({
            ...part,
            state: 'confirm',
            detail: `Type "${short(v.text, 60)}" into "${what}" and submit it on ${site}`
          })
          if (!ok)
            return finish(
              'denied',
              'Not submitted',
              'The person said no. Do not try this again; ask what they want instead.'
            )
        }
        await auto.type(t.wc, v.ref, a, v.text, v.submit)
        return finish('done', `"${short(v.text, 40)}" into ${what}`, await auto.look(t.wc, lookCap))
      }
      if (v.name === 'select_option') {
        const r = await auto.selectOption(t.wc, v.ref, v.option)
        if (!r) return finish('error', what, `Error: control ${v.ref} is not a drop-down.`)
        if (!r.ok)
          return finish(
            'error',
            `"${short(v.option, 30)}" not offered`,
            `Error: no such option. The options are: ${(r.options ?? []).join(' | ')}`
          )
        return finish('done', `${r.text} in ${what}`, await auto.look(t.wc, lookCap))
      }
      if (needsConfirm(a, 'click')) {
        const ok = await env.confirm({
          ...part,
          state: 'confirm',
          detail: `Click "${what}" on ${site}`
        })
        if (!ok)
          return finish(
            'denied',
            'Not clicked',
            'The person said no. Do not click it again; ask what they want instead.'
          )
      }
      await auto.click(t.wc, a)
      return finish('done', what, await auto.look(t.wc, lookCap))
    }
  }
}

export type { ToolName }
