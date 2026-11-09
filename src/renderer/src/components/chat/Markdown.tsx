import { memo, useState } from 'react'
import { parseMarkdown, type Block, type Inline } from '@shared/ai/markdown'

function Inlines({ nodes }: { nodes: Inline[] }): React.JSX.Element {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return n.text
          case 'code':
            return <code key={i}>{n.text}</code>
          case 'strong':
            return (
              <strong key={i}>
                <Inlines nodes={n.children} />
              </strong>
            )
          case 'em':
            return (
              <em key={i}>
                <Inlines nodes={n.children} />
              </em>
            )
          case 'link':
            return (
              <a
                key={i}
                href={n.href}
                title={n.href}
                // a new tab in Panes: the chat panel itself never navigates
                onClick={(e) => {
                  e.preventDefault()
                  window.api.createTab(n.href)
                }}
              >
                <Inlines nodes={n.children} />
              </a>
            )
        }
      })}
    </>
  )
}

function Code({ text, lang }: { text: string; lang: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="chat-code">
      <div className="chat-code-bar">
        <span>{lang || 'code'}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1400)
            })
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre tabIndex={0}>
        <code>{text}</code>
      </pre>
    </div>
  )
}

function BlockView({ b }: { b: Block }): React.JSX.Element {
  switch (b.t) {
    case 'p':
      return (
        <p>
          <Inlines nodes={b.children} />
        </p>
      )
    case 'h': {
      const H = (['h4', 'h4', 'h5'] as const)[b.level - 1]
      return (
        <H>
          <Inlines nodes={b.children} />
        </H>
      )
    }
    case 'quote':
      return (
        <blockquote>
          <Inlines nodes={b.children} />
        </blockquote>
      )
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul'
      return (
        <L>
          {b.items.map((it, i) => (
            <li key={i}>
              <Inlines nodes={it} />
            </li>
          ))}
        </L>
      )
    }
    case 'code':
      return <Code text={b.text} lang={b.lang} />
  }
}

/** A reply as elements built from a parsed tree: there is no raw HTML anywhere in this path. */
export const Markdown = memo(function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="chat-md">
      {parseMarkdown(text).map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </div>
  )
})
