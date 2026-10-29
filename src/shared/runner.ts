/** The offline page's little game: a pane hops over closing tabs. Pure state steps so it can be tested. */
export const RUNNER = {
  width: 600,
  height: 160,
  ground: 132,
  size: 26,
  x: 60,
  gravity: 2400,
  jump: 640,
  startSpeed: 260,
  maxSpeed: 640,
  accel: 9
} as const

export interface Obstacle {
  x: number
  w: number
  h: number
}

export interface RunnerState {
  /** Height of the pane's feet above the ground. */
  y: number
  vy: number
  obstacles: Obstacle[]
  speed: number
  /** Distance covered, in pixels; the score is derived from it. */
  distance: number
  /** Pixels until the next obstacle may appear. */
  gap: number
  over: boolean
}

export const newRunner = (): RunnerState => ({
  y: 0,
  vy: 0,
  obstacles: [],
  speed: RUNNER.startSpeed,
  distance: 0,
  gap: 420,
  over: false
})

export const scoreOf = (s: RunnerState): number => Math.floor(s.distance / 12)

/** Does the pane (a little forgiving at the corners) overlap any obstacle? */
export function hits(s: RunnerState): boolean {
  const slack = 4
  const left = RUNNER.x + slack
  const right = RUNNER.x + RUNNER.size - slack
  return s.obstacles.some(
    (o) => right > o.x + slack && left < o.x + o.w - slack && s.y < o.h - slack
  )
}

/** Advance by `dt` seconds. `jump` is a press this frame; it only works from the ground. */
export function step(s: RunnerState, dt: number, jump: boolean, rand: () => number): RunnerState {
  if (s.over) return s
  const next: RunnerState = { ...s, obstacles: s.obstacles.map((o) => ({ ...o })) }
  if (jump && next.y === 0) next.vy = RUNNER.jump
  next.vy -= RUNNER.gravity * dt
  next.y = Math.max(0, next.y + next.vy * dt)
  if (next.y === 0) next.vy = 0

  const dx = next.speed * dt
  next.distance += dx
  next.speed = Math.min(RUNNER.maxSpeed, next.speed + RUNNER.accel * dt)
  for (const o of next.obstacles) o.x -= dx
  next.obstacles = next.obstacles.filter((o) => o.x + o.w > 0)

  next.gap -= dx
  if (next.gap <= 0) {
    next.obstacles.push({
      x: RUNNER.width,
      w: 14 + Math.floor(rand() * 12),
      h: 20 + Math.floor(rand() * 22)
    })
    // always leave room to land and jump again: scales with speed
    next.gap = next.speed * (0.75 + rand() * 0.7)
  }
  if (hits(next)) next.over = true
  return next
}
