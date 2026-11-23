import { useCallback, useEffect, useState } from 'react'
import type { ScreenSummary } from '@shared/screenTime'
import { formatDuration, MORE_MINUTES } from '@shared/screenTime'
import { HourglassIcon } from '@renderer/components/icons'
import { EmptyState } from '@renderer/internal/ui'

/**
 * Screen time (shared/screenTime.ts, main/screenTime.ts): how long each site was in front of you, today and this
 * week, kept on this computer only; daily limits per site. Opened with ?limit=<site>&back=<address> it is the page a
 * tab shows when that site's time is up.
 */

const params = new URLSearchParams(location.search)
const limited = params.get('limit')
const back = params.get('back')

const LIMIT_CHOICES = [15, 30, 60, 120]
const dayName = (day: string): string =>
  new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short' })

function TimesUp({ site }: { site: string }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <div className="st-up">
      <span className="st-up-icon" aria-hidden="true">
        <HourglassIcon />
      </span>
      <h2>Time&rsquo;s up on {site}</h2>
      <p>You reached the daily limit you set for this site. It opens again tomorrow.</p>
      <div className="st-up-actions">
        <button
          type="button"
          className="int-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await window.panesInternal.screenTimeMore(site)
            if (back) location.replace(back)
          }}
        >
          {MORE_MINUTES} more minutes
        </button>
        <button type="button" className="int-btn primary" onClick={() => history.back()}>
          Go back
        </button>
      </div>
    </div>
  )
}

export function ScreenTime(): React.JSX.Element {
  const [sum, setSum] = useState<ScreenSummary | null>(null)
  const load = useCallback(() => void window.panesInternal.screenTime().then(setSum), [])
  useEffect(() => {
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [load])

  if (limited) return <TimesUp site={limited} />
  if (!sum) return <></>
  const peak = Math.max(60, ...sum.week.map((d) => d.seconds))
  const avg = sum.week.reduce((a, d) => a + d.seconds, 0) / 7
  const limit = (site: string, minutes: number | null): void =>
    void window.panesInternal.screenTimeLimit(site, minutes).then(load)

  return (
    <>
      <section className="st-head">
        <div>
          <span className="st-label">Today</span>
          <b className="st-big">{formatDuration(sum.todayTotal)}</b>
        </div>
        <div>
          <span className="st-label">Daily average this week</span>
          <b className="st-mid">{formatDuration(avg)}</b>
        </div>
      </section>

      <div className="st-week" role="img" aria-label="Time per day this week">
        {sum.week.map((d) => (
          <div key={d.day} className={'st-day' + (d.day === sum.today ? ' today' : '')}>
            <span className="st-bar-box">
              <span
                className="st-bar"
                style={{ height: `${Math.round((d.seconds / peak) * 100)}%` }}
              />
            </span>
            <span className="st-day-name">{dayName(d.day)}</span>
            <span className="st-day-time">{d.seconds >= 60 ? formatDuration(d.seconds) : ''}</span>
          </div>
        ))}
      </div>

      {sum.sites.length === 0 ? (
        <EmptyState icon={<HourglassIcon />} title="Nothing counted yet">
          Time on sites is counted while Panes is the window you use. It stays on this computer;
          private and Tor tabs are never counted.
        </EmptyState>
      ) : (
        <>
          <h2 className="st-h2">Sites</h2>
          <div className="u-group">
            {sum.sites.slice(0, 40).map((s) => {
              const allowed = s.limit !== null ? (s.limit + s.extra) * 60 : 0
              const over = s.limit !== null && s.today >= allowed
              return (
                <div key={s.site} className="u-row int-item st-site">
                  <div className="int-link static">
                    <span className="int-title">{s.site}</span>
                    <span className="int-sub">
                      Today {formatDuration(s.today)} &middot; this week {formatDuration(s.week)}
                      {s.limit !== null &&
                        ` · limit ${formatDuration(s.limit * 60)}${s.extra ? ` + ${s.extra} min today` : ''}${over ? ' (reached)' : ''}`}
                    </span>
                    {s.limit !== null && (
                      <span className="st-meter" aria-hidden="true">
                        <i
                          className={over ? 'over' : ''}
                          style={{ width: `${Math.min(100, (s.today / allowed) * 100)}%` }}
                        />
                      </span>
                    )}
                  </div>
                  <select
                    className="st-limit"
                    aria-label={`Daily limit for ${s.site}`}
                    value={s.limit ?? ''}
                    onChange={(e) => limit(s.site, e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">No limit</option>
                    {[...new Set([...LIMIT_CHOICES, ...(s.limit !== null ? [s.limit] : [])])]
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <option key={m} value={m}>
                          {formatDuration(m * 60)} a day
                        </option>
                      ))}
                  </select>
                </div>
              )
            })}
          </div>
          <p className="st-foot">
            Counted only while Panes is in front and you are there (or a video plays). Kept on this
            computer for 60 days.{' '}
            <button
              type="button"
              className="int-linkbtn"
              onClick={() => void window.panesInternal.screenTimeClear().then(load)}
            >
              Clear history
            </button>
          </p>
        </>
      )}
    </>
  )
}
