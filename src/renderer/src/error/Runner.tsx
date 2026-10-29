import { useEffect, useRef, useState } from 'react'
import { RUNNER, newRunner, scoreOf, step, type RunnerState } from '../../../shared/runner'

const BEST_KEY = 'panes-runner-best'

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0
  } catch {
    return 0
  }
}

/** The offline game: a pane hops over closing tabs. Space, arrow up or a click to jump. */
export function Runner({ onQuit }: { onQuit: () => void }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [shown, setShown] = useState({ score: 0, best: readBest(), over: false })

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const css = getComputedStyle(document.documentElement)
    const fg = css.getPropertyValue('--fg').trim() || '#888'
    const accent = css.getPropertyValue('--accent').trim() || '#8b8bff'
    const dpr = window.devicePixelRatio || 1
    el.width = RUNNER.width * dpr
    el.height = RUNNER.height * dpr
    ctx.scale(dpr, dpr)

    let state: RunnerState = newRunner()
    let jump = false
    let last = performance.now()
    let raf = 0
    let best = readBest()

    const draw = (): void => {
      ctx.clearRect(0, 0, RUNNER.width, RUNNER.height)
      ctx.globalAlpha = 0.25
      ctx.fillStyle = fg
      ctx.fillRect(0, RUNNER.ground, RUNNER.width, 2)
      ctx.globalAlpha = 0.7
      for (const o of state.obstacles) {
        ctx.beginPath()
        ctx.roundRect(o.x, RUNNER.ground - o.h, o.w, o.h, 4)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.roundRect(RUNNER.x, RUNNER.ground - RUNNER.size - state.y, RUNNER.size, RUNNER.size, 7)
      ctx.fill()
    }

    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      state = step(state, dt, jump, Math.random)
      jump = false
      draw()
      const score = scoreOf(state)
      if (state.over) best = Math.max(best, score)
      setShown((p) =>
        p.score === score && p.over === state.over ? p : { score, best, over: state.over }
      )
      if (state.over) {
        try {
          localStorage.setItem(BEST_KEY, String(best))
        } catch {
          // storage unavailable: the best score just does not stick
        }
        return
      }
      raf = requestAnimationFrame(tick)
    }

    const press = (): void => {
      if (state.over) {
        state = newRunner()
        last = performance.now()
        raf = requestAnimationFrame(tick)
      } else {
        jump = true
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault()
        press()
      } else if (e.key === 'Escape') onQuit()
    }
    window.addEventListener('keydown', onKey)
    el.addEventListener('pointerdown', press)
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      el.removeEventListener('pointerdown', press)
    }
  }, [onQuit])

  return (
    <div className="runner">
      <canvas ref={canvas} style={{ width: RUNNER.width, height: RUNNER.height }} />
      <div className="runner-bar">
        <span>{shown.over ? 'Game over. Space to go again, Esc to leave.' : 'Space to jump'}</span>
        <span>
          {shown.score} <i>best {shown.best}</i>
        </span>
      </div>
    </div>
  )
}
