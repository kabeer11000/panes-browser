import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** What broke, in the message: "the board", "Panes". */
  what: string
  children: ReactNode
  /** A way out besides trying again (for the board: back to the pages). */
  leave?: { label: string; run: () => void }
}

/**
 * A render error below this shows a message with a way back instead of a blank window. Without it React unmounts the
 * whole tree on any throw (the board went white on a label that grew in a loop).
 */
export class Recover extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[recover] ${this.props.what}`, error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const { what, leave } = this.props
    return (
      <div className="recover" role="alert">
        <p className="recover-title">Something went wrong in {what}.</p>
        <p className="recover-sub">
          What was saved is still there. Try again, or reload if it keeps happening.
        </p>
        <div className="recover-actions">
          <button className="recover-btn primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          {leave && (
            <button className="recover-btn" onClick={leave.run}>
              {leave.label}
            </button>
          )}
          <button className="recover-btn" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}
