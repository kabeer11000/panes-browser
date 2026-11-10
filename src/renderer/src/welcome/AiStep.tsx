import { useEffect, useState } from 'react'
import type { AiSettings, AiStatus } from '@shared/ai/types'
import type { Settings } from '@shared/types'
import { Segmented, Toggle } from '@renderer/internal/ui'
import { formatBytes } from '@renderer/internal/format'

type Where = 'local' | 'online'

/**
 * The first-run AI step: off by default; on this computer (one download, then offline) or online (sign in). The same
 * calls as Settings, AI (internal/pages/AiSection.tsx), which has everything else; nothing is downloaded or signed in
 * without a click here.
 */
export function AiStep({
  ai,
  update
}: {
  ai: AiSettings
  update: (patch: Partial<Settings>) => void
}): React.JSX.Element {
  const api = window.panesInternal
  const [st, setSt] = useState<AiStatus | null>(null)
  const [where, setWhere] = useState<Where>('local')
  useEffect(() => {
    const load = (): void => void api.aiStatus().then(setSt)
    load()
    return api.onAiChanged(load)
  }, [api])

  const setAi = (patch: Partial<AiSettings>): void => update({ ai: { ...ai, ...patch } })
  const dl = st?.download
  const pct = dl && dl.total > 0 ? Math.round((dl.received / dl.total) * 100) : 0
  const size = st && st.installBytes > 0 ? formatBytes(st.installBytes) : 'about 1.4 GB'
  const signedIn = (p: 'chatgpt' | 'openrouter'): boolean =>
    !!st?.keys.find((k) => k.provider === p && (k.signedIn || k.hasKey))
  const waiting = st?.signIn?.state === 'waiting' ? st.signIn.provider : null
  const failed = st?.signIn?.state === 'failed' ? st.signIn.message : ''

  return (
    <>
      <h1>AI, if you want it</h1>
      <p className="wl-lede">Off until you turn it on. You can change all of this in Settings.</p>
      <div className="wl-list">
        <div className="wl-row">
          <span>
            Use AI in Panes
            <em>
              Chat about pages, ask about selected text, clearer tab and file names, the canvas.
            </em>
          </span>
          <Toggle label="Use AI in Panes" on={ai.enabled} onChange={(v) => setAi({ enabled: v })} />
        </div>
        {ai.enabled && (
          <div className="wl-row col">
            <span>
              Where it runs
              <em>
                {where === 'local'
                  ? `On this computer: a ${size} download, once, checked before use. After that it works without the internet and pages never leave this computer.${st?.slowDevice ? ' This computer is on the slow side for it, so answers may take a while; Online is quicker.' : ''}`
                  : 'Online: a model from ChatGPT or OpenRouter. Faster and smarter on most computers; what you ask goes to that service.'}
              </em>
            </span>
            <Segmented<Where>
              label="Where AI runs"
              value={where}
              options={[
                { value: 'local', label: 'This computer' },
                { value: 'online', label: 'Online' }
              ]}
              onChange={setWhere}
            />
            {where === 'local' &&
              st &&
              (!st.supported ? (
                <p className="wl-note">
                  There is no local model for this system yet. Online works.
                </p>
              ) : st.installed ? (
                <p className="wl-note">The local model is ready.</p>
              ) : dl ? (
                <div className="wl-ai-actions">
                  <span className="wl-note">
                    Downloading, {pct}% ({formatBytes(dl.received)} of {formatBytes(dl.total)}). You
                    can go on.
                  </span>
                  <button
                    type="button"
                    className="wl-ghost"
                    onClick={() => void api.aiCancelDownload()}
                  >
                    Stop
                  </button>
                </div>
              ) : (
                <div className="wl-ai-actions">
                  <button type="button" className="wl-ghost" onClick={() => void api.aiDownload()}>
                    Download the local model ({size})
                  </button>
                  {st.error && <span className="wl-note">Last try failed: {st.error}</span>}
                </div>
              ))}
            {where === 'online' && (
              <div className="wl-ai-actions">
                {(['chatgpt', 'openrouter'] as const).map((p) =>
                  signedIn(p) ? (
                    <span key={p} className="wl-ok">
                      {p === 'chatgpt' ? 'ChatGPT' : 'OpenRouter'} connected
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      className="wl-ghost"
                      disabled={waiting !== null}
                      onClick={() => void api.aiSignIn(p)}
                    >
                      {waiting === p
                        ? 'Waiting for the browser...'
                        : `Sign in with ${p === 'chatgpt' ? 'ChatGPT' : 'OpenRouter'}`}
                    </button>
                  )
                )}
                {failed && <span className="wl-note">{failed}</span>}
                <span className="wl-note">API keys for other providers: Settings, AI.</span>
              </div>
            )}
          </div>
        )}
        <div className="wl-row col">
          <span>
            Private and Tor tabs stay out of it
            <em>
              Their pages are never read, saved, indexed or sent to any model, local or online.
            </em>
          </span>
        </div>
      </div>
    </>
  )
}
