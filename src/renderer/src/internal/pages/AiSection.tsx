import { useEffect, useRef, useState } from 'react'
import { MODELS } from '@shared/ai/models'
import { resolveChatTarget, type ChatTarget } from '@shared/ai/policy'
import {
  CLOUD_LABEL,
  CLOUD_PROVIDERS,
  DEFAULT_AI_SETTINGS,
  type AiSettings,
  type AiStatus,
  type ChatChoice,
  type CredentialProvider,
  type ServerStatus
} from '@shared/ai/types'
import type { Settings } from '@shared/types'
import { formatBytes } from '@renderer/internal/format'
import { Group, Row, Segmented, Select, Toggle } from '@renderer/internal/ui'

type KeyedProvider = CredentialProvider

/** A text box that is saved when you leave it or press Enter, not on every key. */
function TextField({
  value,
  onCommit,
  label,
  placeholder,
  secret
}: {
  value: string
  onCommit: (v: string) => void
  label: string
  placeholder?: string
  secret?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    // the saved value changed from outside (a reset, another provider): show it
    setSeen(value)
    setDraft(value)
  }
  const commit = (): void => {
    if (draft.trim() !== value) onCommit(draft.trim())
  }
  return (
    <input
      className="u-input ai-field"
      type={secret ? 'password' : 'text'}
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(value)
      }}
    />
  )
}

/** Content that opens and closes by height and fade (CSS only, so it needs no layout measuring). */
function Reveal({
  open,
  children
}: {
  open: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={'ai-reveal' + (open ? ' open' : '')} aria-hidden={!open} inert={!open}>
      <div>{children}</div>
    </div>
  )
}

const SERVER_TEXT: Record<ServerStatus['state'], string> = {
  off: 'Sleeping',
  'needs-download': 'Not downloaded',
  downloading: 'Downloading',
  starting: 'Starting',
  ready: 'Running',
  error: 'Stopped'
}

/** The model card's headline and detail, in words a person would use. */
function describe(
  st: AiStatus,
  ai: AiSettings
): { tone: 'ok' | 'busy' | 'bad' | 'idle'; label: string; hint: string } {
  const total = formatBytes(st.installBytes)
  if (!st.supported)
    return {
      tone: 'idle',
      label: 'Not available here yet',
      hint: 'There is no local runtime for this system. An online provider below still works.'
    }
  if (ai.localProvider === 'openai-compatible')
    return {
      tone: 'idle',
      label: 'Using your own server',
      hint: 'Panes sends background requests to the address below.'
    }
  if (st.download) {
    const { received, total: all } = st.download
    return {
      tone: 'busy',
      label: 'Downloading local model',
      hint: all > 0 ? `${formatBytes(received)} of ${formatBytes(all)}` : formatBytes(received)
    }
  }
  if (st.error && !st.installed) return { tone: 'bad', label: 'Download failed', hint: st.error }
  if (!st.installed)
    return {
      tone: 'idle',
      label: 'Local model not downloaded',
      hint: `${total} in all, downloaded once and checked before use. It works without an internet connection after that.`
    }
  const bad = [st.chat, st.embed].find((x) => x.state === 'error')
  if (bad) return { tone: 'bad', label: 'Local model stopped', hint: bad.message }
  if (st.chat.state === 'starting' || st.embed.state === 'starting')
    return { tone: 'busy', label: 'Starting local model', hint: 'This takes a few seconds.' }
  const accel =
    st.accel === 'gpu'
      ? 'using your graphics card'
      : st.accel === 'cpu'
        ? 'on the processor'
        : 'on this computer'
  return {
    tone: 'ok',
    label: 'Local model ready',
    hint: `Running ${accel}. Nothing leaves this computer.${st.slowDevice ? ' Answers may be slow on this computer; an online model is quicker.' : ''}`
  }
}

/** An API key field: write-only. Once saved it is only ever shown as "Key saved". */
function KeyRow({
  provider,
  label,
  hasKey,
  optional,
  action
}: {
  provider: KeyedProvider
  label: string
  hasKey: boolean
  optional?: boolean
  /** A button before the field (Get a free key). */
  action?: React.ReactNode
}): React.JSX.Element {
  const api = window.panesInternal
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const save = (): void => {
    setError('')
    setBusy(true)
    void api
      .aiSetKey(provider, key)
      .then(() => setKey(''))
      .catch((e: unknown) =>
        setError(
          e instanceof Error
            ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
            : 'Could not save the key'
        )
      )
      .finally(() => setBusy(false))
  }
  if (hasKey) {
    return (
      <Row
        label={label}
        hint="Key saved. It stays on this computer, encrypted, and is never shown again."
      >
        <button className="int-btn small danger" onClick={() => void api.aiRemoveKey(provider)}>
          Remove
        </button>
      </Row>
    )
  }
  return (
    <Row
      label={label}
      hint={
        busy
          ? 'Checking the key...'
          : error ||
            (optional ? 'Only if your server asks for one.' : 'Paste a key from the provider.')
      }
    >
      <span className="u-actions">
        {action}
        <input
          className="u-input ai-field"
          type="password"
          value={key}
          aria-label={label}
          placeholder="Paste key"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && key.trim() && save()}
        />
        <button className="int-btn small" disabled={!key.trim() || busy} onClick={save}>
          Save
        </button>
      </span>
    </Row>
  )
}

/** AI: the master switch, the local model, the quiet features, an optional online provider, and its data. */
/** What a failed move says, without Electron's "Error invoking remote method" wrapping. */
const moveReason = (e: unknown): string =>
  `Could not move the models: ${(e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`

export function AiSection({
  s,
  update
}: {
  s: Settings
  update: (patch: Partial<Settings>) => Promise<void>
}): React.JSX.Element {
  const api = window.panesInternal
  const ai = s.ai ?? DEFAULT_AI_SETTINGS
  const [st, setSt] = useState<AiStatus | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  // panes://settings#ai (from the chat panel's Choose a model) scrolls here
  useEffect(() => {
    const go = (): void => {
      if (location.hash === '#ai')
        window.setTimeout(
          () => document.getElementById('ai')?.scrollIntoView({ block: 'start' }),
          80
        )
    }
    go()
    window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [])
  useEffect(() => {
    const load = (): void => void api.aiStatus().then(setSt)
    load()
    return api.onAiChanged(load)
  }, [api])
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(false), 3500)
    return () => clearTimeout(t)
  }, [confirm])

  // what was last sent, so two quick changes both count (the page has not re-rendered between them)
  const latest = useRef(ai)
  useEffect(() => {
    latest.current = ai
  }, [ai])
  const setAi = (patch: Partial<AiSettings>): void => {
    latest.current = { ...latest.current, ...patch }
    void update({ ai: latest.current })
  }
  const hasKey = (p: KeyedProvider): boolean => !!st?.keys.find((k) => k.provider === p)?.hasKey
  const local = ai.localProvider === 'local'
  const d = st ? describe(st, ai) : null
  const downloading = !!st?.download
  const pct =
    st?.download && st.download.total > 0 ? (st.download.received / st.download.total) * 100 : 0

  return (
    <>
      <Group id="ai" title="AI" footer="Private and Tor tabs are never sent to AI.">
        <Row
          label="Use AI"
          hint="Quiet suggestions, the chat panel and the canvas view. They run on this computer by default, with no account."
        >
          <Toggle label="Use AI" on={ai.enabled} onChange={(v) => setAi({ enabled: v })} />
        </Row>
      </Group>

      <Reveal open={ai.enabled}>
        <Group title="Local model">
          <Row label="Run models on">
            <Segmented
              label="Run models on"
              value={ai.localProvider}
              options={[
                { value: 'local', label: 'This computer' },
                { value: 'openai-compatible', label: 'My own server' }
              ]}
              onChange={(v) => setAi({ localProvider: v })}
            />
          </Row>
          {st && d && (
            <div className="u-row ai-card" data-tone={d.tone}>
              <div className="u-text">
                <div className="u-label ai-status">
                  <span className="ai-dot" aria-hidden="true" />
                  <span aria-live="polite">{d.label}</span>
                </div>
                <div className="u-hint">{d.hint}</div>
              </div>
              {local && st.supported && (
                <span className="u-actions">
                  {downloading ? (
                    <button className="int-btn small" onClick={() => void api.aiCancelDownload()}>
                      Cancel
                    </button>
                  ) : d.tone === 'bad' ? (
                    <button className="int-btn small" onClick={() => void api.aiRetry()}>
                      Try again
                    </button>
                  ) : st.installed ? (
                    <button className="int-btn small" onClick={() => void api.aiRemoveLocal()}>
                      Remove
                    </button>
                  ) : (
                    <button className="int-btn small" onClick={() => void api.aiDownload()}>
                      Download {formatBytes(st.installBytes)}
                    </button>
                  )}
                </span>
              )}
            </div>
          )}
          {local && st && st.supported && (
            <div
              className={'ai-bar' + (downloading ? ' on' : '')}
              role="progressbar"
              aria-label="Download progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
            >
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
          {local && st && st.supported && (
            <>
              {(['chat', 'embed'] as const).map((role) => (
                <Row
                  key={role}
                  label={role === 'chat' ? 'Language model' : 'Search model'}
                  hint={`${MODELS[role].name}, ${formatBytes(MODELS[role].size)}. ${MODELS[role].purpose}.`}
                >
                  <span className="int-sub">
                    {st.installed || downloading
                      ? st[role].message || SERVER_TEXT[st[role].state]
                      : ''}
                  </span>
                </Row>
              ))}
              <Row
                label="Models folder"
                hint={
                  st.moving
                    ? 'Moving the models there. Local AI waits until they are in place.'
                    : (moveError ?? st.modelsDir)
                }
              >
                <span className="u-actions">
                  <button
                    className="int-btn small"
                    disabled={st.moving}
                    onClick={() => void api.aiOpenModelsDir()}
                  >
                    Open
                  </button>
                  {st.modelsDirCustom && (
                    <button
                      className="int-btn small"
                      disabled={st.moving || downloading}
                      onClick={() => {
                        setMoveError(null)
                        api.aiResetModelsDir().catch((e: unknown) => setMoveError(moveReason(e)))
                      }}
                    >
                      Reset
                    </button>
                  )}
                  <button
                    className="int-btn small"
                    disabled={st.moving || downloading}
                    title={downloading ? 'Wait for the download to finish' : undefined}
                    onClick={() => {
                      setMoveError(null)
                      api.aiPickModelsDir().catch((e: unknown) => setMoveError(moveReason(e)))
                    }}
                  >
                    {st.moving ? 'Moving…' : 'Change'}
                  </button>
                </span>
              </Row>
            </>
          )}
          {!local && (
            <>
              <Row
                label="Server address"
                hint="An OpenAI-compatible address, such as Ollama or LM Studio."
              >
                <TextField
                  label="Server address"
                  value={ai.compatibleUrl}
                  placeholder="http://127.0.0.1:11434/v1"
                  onCommit={(v) => setAi({ compatibleUrl: v })}
                />
              </Row>
              <Row
                label="Model name"
                hint="Used for titles and names. The same one is asked to embed pages."
              >
                <TextField
                  label="Model name"
                  value={ai.compatibleModel}
                  placeholder="qwen3:1.7b"
                  onCommit={(v) => setAi({ compatibleModel: v })}
                />
              </Row>
              <KeyRow
                provider="openai-compatible"
                label="Server key"
                hasKey={hasKey('openai-compatible')}
                optional
              />
            </>
          )}
        </Group>

        <Group title="What AI does">
          <Row
            label="Cleaner tab titles"
            hint="Trims site names and long titles in the tab list. The page's own title stays in the hover card."
          >
            <Toggle
              label="Cleaner tab titles"
              on={ai.titles}
              onChange={(v) => setAi({ titles: v })}
            />
          </Row>
          <Row
            label="Better download names"
            hint="When a file arrives as download or image (2), Downloads offers a clearer name. Nothing is renamed until you accept."
          >
            <Toggle
              label="Better download names"
              on={ai.filenames}
              onChange={(v) => setAi({ filenames: v })}
            />
          </Row>
          <Row
            label="Suggest tab groups"
            hint="Notices open tabs that belong together. It will show up once tab groups are back; they are switched off for now."
          >
            <Toggle
              label="Suggest tab groups"
              on={ai.grouping}
              onChange={(v) => setAi({ grouping: v })}
            />
          </Row>
          <Row
            label="Group canvas by meaning"
            hint="The canvas view sorts your tabs into named frames by what they are about. Tabs are read once, here, and nothing else changes."
          >
            <Toggle
              label="Group canvas by meaning"
              on={ai.canvas}
              onChange={(v) => setAi({ canvas: v })}
            />
          </Row>
          <Row
            label="Search history by meaning"
            hint="The command bar also finds pages by what they are about. Pages are read once, here, and kept in an index on this computer."
          >
            <Toggle
              label="Search history by meaning"
              on={ai.semanticHistory}
              onChange={(v) => setAi({ semanticHistory: v })}
            />
          </Row>
          <Row
            label="Ask about selected text"
            hint="Select words on a page and a small chip offers Ask, Explain, Translate and Summarise. Only the selected text is sent. Never in private or Tor tabs, and never in text fields."
          >
            <Toggle
              label="Ask about selected text"
              on={ai.selectionAsk}
              onChange={(v) => setAi({ selectionAsk: v })}
            />
          </Row>
        </Group>

        <CloudAi ai={ai} st={st} setAi={setAi} hasKey={hasKey} />

        <Group title="AI data">
          <Row
            label="Remove AI data"
            hint={`${formatBytes(st?.dataBytes ?? 0)} on this computer: the models, the search index and saved titles. Your key and settings stay.`}
          >
            <button
              className="int-btn small danger"
              onClick={() => {
                if (!confirm) return setConfirm(true)
                setConfirm(false)
                void api.aiRemoveData()
              }}
            >
              {confirm ? 'Click again to remove' : 'Remove'}
            </button>
          </Row>
        </Group>
      </Reveal>
    </>
  )
}

/** One account row: what it is, who is signed in, and the one action that fits the state. */
function AccountRow({
  label,
  hint,
  children
}: {
  label: string
  hint: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Row label={label} hint={hint}>
      <span className="u-actions">{children}</span>
    </Row>
  )
}

type Account = 'chatgpt' | 'openrouter'

/**
 * Cloud AI: sign in or add a key for each online provider, and pick which one chat uses. Signing in opens the
 * provider's own page in the browser; the tokens stay in the main process and this page only learns who is
 * signed in. ChatGPT is for chat alone: background features stay on the local model.
 */
function CloudAi({
  ai,
  st,
  setAi,
  hasKey
}: {
  ai: AiSettings
  st: AiStatus | null
  setAi: (patch: Partial<AiSettings>) => void
  hasKey: (p: KeyedProvider) => boolean
}): React.JSX.Element {
  const api = window.panesInternal
  const [orKey, setOrKey] = useState(false)
  const [models, setModels] = useState<Array<{ slug: string; name: string }>>([])
  const gpt = st?.keys.find((k) => k.provider === 'chatgpt')
  const orIn = hasKey('openrouter')
  const gptIn = !!gpt?.signedIn
  const gptPlan = gptIn && gpt?.planUsage !== false
  const pending = st?.signIn
  const waiting = (p: Account): boolean => pending?.provider === p && pending.state === 'waiting'
  const failed = (p: Account): string =>
    pending?.provider === p && pending.state === 'failed' ? pending.message : ''

  useEffect(() => {
    if (gptPlan) void api.aiChatgptModels().then(setModels)
  }, [api, gptPlan])

  const online: ChatTarget[] = [
    ...(gptPlan ? (['chatgpt'] as const) : []),
    ...CLOUD_PROVIDERS.filter(hasKey)
  ]
  const auto = resolveChatTarget(ai, { local: true, online })
  const localLabel = ai.localProvider === 'openai-compatible' ? 'My own server' : 'This computer'
  const name = (t: ChatTarget | null): string =>
    t === 'chatgpt' ? 'ChatGPT plan' : t === 'local' || t === null ? localLabel : CLOUD_LABEL[t]
  const options: Array<{ value: ChatChoice; label: string }> = [
    { value: 'auto', label: `Automatic (${name(auto)})` },
    { value: 'local', label: localLabel },
    ...online.map((t) => ({ value: t as ChatChoice, label: name(t) }))
  ]
  if (!options.some((o) => o.value === ai.chatProvider))
    options.push({
      value: ai.chatProvider,
      label: `${name(ai.chatProvider as ChatTarget)} (not set up)`
    })
  const chatTarget = ai.chatProvider === 'auto' ? auto : (ai.chatProvider as ChatTarget)
  const keyed = CLOUD_PROVIDERS.filter(hasKey)

  const gptHint =
    failed('chatgpt') ||
    (waiting('chatgpt')
      ? pending?.message || 'Finish signing in in your browser.'
      : st?.chatgptReauth
        ? 'Your sign-in ended. Sign in again to keep using your plan.'
        : gptIn
          ? gptPlan
            ? `${gpt?.account ?? 'Signed in'}. Chat uses your ChatGPT plan.`
            : `${gpt?.account ?? 'Signed in'}, without permission to use your plan. Continue again and allow it.`
          : 'Use your ChatGPT plan for chat. Background features stay on this computer.')

  return (
    <Group
      title="Cloud AI"
      footer="Optional. Sign-ins and keys are stored encrypted on this computer and are never shown again. Chat sends the pages you share and what you type; Private and Tor tabs are never sent."
    >
      <AccountRow label="ChatGPT" hint={gptHint}>
        {waiting('chatgpt') ? (
          <button className="int-btn small" onClick={() => void api.aiCancelSignIn()}>
            Cancel
          </button>
        ) : (
          <>
            {gptIn && (
              <button
                className="int-btn small danger"
                onClick={() => void api.aiSignOut('chatgpt')}
              >
                Sign out
              </button>
            )}
            {(!gptPlan || st?.chatgptReauth) && (
              <button
                className="int-btn small primary"
                onClick={() => void api.aiSignIn('chatgpt')}
              >
                Continue with ChatGPT
              </button>
            )}
          </>
        )}
      </AccountRow>

      {orIn ? (
        <AccountRow label="OpenRouter" hint="Connected. Models from many providers, one key.">
          <button className="int-btn small danger" onClick={() => void api.aiSignOut('openrouter')}>
            Sign out
          </button>
        </AccountRow>
      ) : (
        <>
          <AccountRow
            label="OpenRouter"
            hint={
              failed('openrouter') ||
              (waiting('openrouter')
                ? 'Finish signing in in your browser.'
                : 'Many models behind one account. You approve a key in your browser.')
            }
          >
            {waiting('openrouter') ? (
              <button className="int-btn small" onClick={() => void api.aiCancelSignIn()}>
                Cancel
              </button>
            ) : (
              <>
                <button className="int-btn small" onClick={() => setOrKey((v) => !v)}>
                  {orKey ? 'Hide key' : 'Use a key'}
                </button>
                <button
                  className="int-btn small primary"
                  onClick={() => void api.aiSignIn('openrouter')}
                >
                  Sign in with OpenRouter
                </button>
              </>
            )}
          </AccountRow>
          {orKey && <KeyRow provider="openrouter" label="OpenRouter key" hasKey={false} />}
        </>
      )}

      <KeyRow
        provider="google"
        label="Gemini key"
        hasKey={hasKey('google')}
        action={
          <button className="int-btn small" onClick={() => void api.aiOpenGeminiKeyPage()}>
            Get a free key
          </button>
        }
      />
      <KeyRow provider="openai" label="OpenAI key" hasKey={hasKey('openai')} />
      <Row
        label="Custom server"
        hint={
          ai.localProvider === 'openai-compatible'
            ? 'In use. Its address is under Local model above.'
            : 'Ollama, LM Studio or any OpenAI-compatible address.'
        }
      >
        {ai.localProvider !== 'openai-compatible' && (
          <button
            className="int-btn small"
            onClick={() => setAi({ localProvider: 'openai-compatible' })}
          >
            Custom server
          </button>
        )}
      </Row>

      <Row
        label="Chat uses"
        hint={
          chatTarget === null
            ? 'Nothing is set up yet. Sign in, add a key, or use the local model.'
            : `Chat is answered by ${name(chatTarget)}. It never switches to another paid provider by itself.`
        }
      >
        <Select
          label="Chat uses"
          value={ai.chatProvider}
          options={options}
          onChange={(v) => setAi({ chatProvider: v })}
        />
      </Row>
      {chatTarget === 'chatgpt' && gptPlan && models.length > 0 && (
        <Row label="ChatGPT model" hint="The models your plan lists.">
          <Select
            label="ChatGPT model"
            value={ai.chatgptModel || models[0].slug}
            options={models.map((m) => ({ value: m.slug, label: m.name }))}
            onChange={(v) => setAi({ chatgptModel: v })}
          />
        </Row>
      )}
      {chatTarget && chatTarget !== 'local' && chatTarget !== 'chatgpt' && (
        <Row label={`${CLOUD_LABEL[chatTarget]} model`} hint="A small, fast model is plenty.">
          <TextField
            key={chatTarget}
            label="Model"
            value={ai.cloudModels[chatTarget]}
            onCommit={(v) => setAi({ cloudModels: { ...ai.cloudModels, [chatTarget]: v } })}
          />
        </Row>
      )}

      {keyed.length > 0 && (
        <>
          <Row
            label="Background features"
            hint="Titles, file names and group names use the local model. This is only a fallback."
          >
            <Select
              label="Background fallback provider"
              value={ai.cloudProvider ?? 'none'}
              options={[
                { value: 'none', label: 'None' },
                ...keyed.map((p) => ({ value: p, label: CLOUD_LABEL[p] }))
              ]}
              onChange={(v) => setAi({ cloudProvider: v === 'none' ? null : v })}
            />
          </Row>
          {ai.cloudProvider && (
            <Row
              label="Use it when the local model is unavailable"
              hint="Only a title, a file name or a few lines of a page's text are sent. Off, they wait for the local model."
            >
              <Toggle
                label="Use the online provider for background features"
                on={ai.cloudForBackground}
                onChange={(v) => setAi({ cloudForBackground: v })}
              />
            </Row>
          )}
        </>
      )}
    </Group>
  )
}
