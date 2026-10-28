import { useEffect, useState } from 'react'

const HINTS: Array<[string, string]> = [
  ['Ctrl L', 'address'],
  ['Ctrl T', 'new tab'],
  ['Ctrl Shift A', 'all tabs'],
  ['Ctrl B', 'sidebar']
]

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function NewTab(): React.JSX.Element {
  const now = useClock()
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <div className="newtab">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="newtab-body">
        <div className="newtab-time">{time}</div>
        <div className="newtab-date">{date}</div>
        <div className="newtab-hints">
          {HINTS.map(([k, label]) => (
            <span key={k}>
              <kbd>{k}</kbd> {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
