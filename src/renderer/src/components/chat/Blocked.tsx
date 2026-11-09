import type { ChatBlock } from '@shared/ai/chatState'
import { formatBytes } from '@renderer/internal/format'

interface View {
  title: string
  text: string
  primary?: { label: string; run: () => void }
  secondary?: { label: string; run: () => void }
  progress?: number
}

const act = (a: Parameters<typeof window.api.chatAction>[0]) => (): void => window.api.chatAction(a)

function view(b: ChatBlock): View {
  switch (b.kind) {
    case 'off':
      return {
        title: 'AI is off',
        text: 'Turn it on to chat with your tabs. Panes can answer on this computer, with no account.',
        primary: { label: 'Turn on AI', run: act('enable-ai') }
      }
    case 'download':
      return {
        title: 'Download the local model',
        text: 'Chat runs on this computer and works offline once the model is here. It is a one-time download, checked before use.',
        primary: { label: `Download local model (${formatBytes(b.bytes)})`, run: act('download') },
        secondary: { label: 'Choose another model', run: act('settings') }
      }
    case 'downloading':
      return {
        title: 'Downloading the local model',
        text:
          b.total > 0
            ? `${formatBytes(b.received)} of ${formatBytes(b.total)}. Chat starts by itself when it is done.`
            : formatBytes(b.received),
        progress: b.total > 0 ? (b.received / b.total) * 100 : 0,
        secondary: { label: 'Cancel', run: act('cancel-download') }
      }
    case 'local-error':
      return {
        title: 'The local model stopped',
        text: b.message,
        primary: { label: 'Try again', run: act('retry') },
        secondary: { label: 'Choose another model', run: act('settings') }
      }
    case 'reauth':
      return {
        title: 'ChatGPT needs you again',
        text: 'Your sign-in ended. Sign in again to keep using your ChatGPT plan.',
        primary: { label: 'Sign in again', run: act('settings') }
      }
    case 'unsupported':
      return {
        title: 'No local model here yet',
        text: 'Panes cannot run a local model on this system. Sign in or add a key for an online model.',
        primary: { label: 'Choose a model', run: act('settings') }
      }
    case 'no-model':
      return {
        title: 'Choose a model',
        text: 'The model you picked is not set up. Pick another, sign in, or add a key.',
        primary: { label: 'Choose a model', run: act('settings') }
      }
  }
}

/** A "cannot chat" state: what is wrong in plain words, and the one thing to do about it. */
export function Blocked({ block }: { block: ChatBlock }): React.JSX.Element {
  const v = view(block)
  return (
    <div className="chat-state">
      <h3>{v.title}</h3>
      <p aria-live="polite">{v.text}</p>
      {v.progress !== undefined && (
        <div
          className="chat-bar"
          role="progressbar"
          aria-label="Download progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(v.progress)}
        >
          <span style={{ width: `${v.progress}%` }} />
        </div>
      )}
      {(v.primary || v.secondary) && (
        <div className="chat-state-actions">
          {v.primary && (
            <button type="button" className="chat-btn primary" onClick={v.primary.run}>
              {v.primary.label}
            </button>
          )}
          {v.secondary && (
            <button type="button" className="chat-btn" onClick={v.secondary.run}>
              {v.secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
