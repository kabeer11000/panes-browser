const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k))
    } catch {
      return null
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem(k)
      else localStorage.setItem(k, JSON.stringify(v))
    } catch {
      /* private window: nothing kept, nothing lost */
    }
  }
}

// ---------- Reveal on scroll ----------
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.classList.add('in')
      io.unobserve(e.target)
    }
  },
  { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
)
document.querySelectorAll('.reveal').forEach((el) => io.observe(el))

// ---------- Clips play only while they're on screen ----------
const vio = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const v = e.target
      if (e.isIntersecting && !reduced) {
        if (v.preload === 'none') v.preload = 'auto'
        v.play().catch(() => {})
      } else v.pause()
    }
  },
  { threshold: 0.35 }
)
document.querySelectorAll('.shot video').forEach((v) => {
  vio.observe(v)
  if (reduced) v.controls = true
})

// ---------- Top bar: tints violet over the band ----------
const bar = document.getElementById('top')
const band = document.getElementById('moving')
const tint = () => {
  const r = band.getBoundingClientRect()
  bar.classList.toggle('on-band', r.top < 50 && r.bottom > 50)
}

// ---------- The trail: from the hero's clip down the page, clip to clip ----------
const journey = document.getElementById('journey')
const svg = document.getElementById('jtrails')
const ahead = document.getElementById('jahead')
const walked = document.getElementById('jwalked')
const draw = document.getElementById('jdraw')
const pin = document.getElementById('jpin')
const shots = [...journey.querySelectorAll('.shot')]
let samples = []
let stops = []
let total = 0

function layout() {
  if (getComputedStyle(svg).display === 'none') return
  const j = journey.getBoundingClientRect()
  const pts = shots.map((s) => {
    const r = s.getBoundingClientRect()
    return { x: r.left - j.left + r.width / 2, top: r.top - j.top, bottom: r.bottom - j.top }
  })
  // Each stretch leaves one clip from the middle of its bottom edge and arrives at the next one's top, in an easy S
  let d = ''
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const k = (b.top - a.bottom) * 0.6
    d += `M${a.x},${a.bottom + 8} C${a.x},${a.bottom + k} ${b.x},${b.top - k} ${b.x},${b.top - 8} `
  }
  svg.setAttribute('viewBox', `0 0 ${j.width} ${j.height}`)
  for (const p of [ahead, walked, draw]) p.setAttribute('d', d)
  total = draw.getTotalLength()
  draw.style.strokeDasharray = `${total} ${total}`
  // Sample the path so a page height maps to a length along it
  samples = []
  const n = 400
  for (let i = 0; i <= n; i++) {
    const l = (total * i) / n
    samples.push({ l, y: draw.getPointAtLength(l).y })
  }
  stops = pts.map((p) => ({ x: p.x, y: p.top }))
  progress()
}

function progress() {
  tint()
  if (!samples.length) return
  const j = journey.getBoundingClientRect()
  const line = innerHeight * 0.62 - j.top
  let l = 0
  for (const s of samples) if (s.y <= line) l = Math.max(l, s.l)
  draw.style.strokeDashoffset = String(total - l)
  // The pin stands on the last clip the walk has reached
  let at = -1
  for (let i = 0; i < stops.length; i++) if (stops[i].y + 60 <= line) at = i
  if (at < 0) at = 0
  pin.style.transform = `translate(${stops[at].x}px, ${stops[at].y}px)`
  pin.classList.add('in')
}

let raf = 0
const onScroll = () => {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    progress()
  })
}
addEventListener('scroll', onScroll, { passive: true })
addEventListener('resize', () => requestAnimationFrame(layout))
addEventListener('load', layout)
new ResizeObserver(() => requestAnimationFrame(layout)).observe(journey)
layout()

// ---------- Stickers: drag one anywhere in the hero, and it stays there ----------
const hero = document.getElementById('hero')
const hint = document.getElementById('hint')
const reset = hint.querySelector('.reset')
const say = hint.querySelector('.say')
const stickers = [...document.querySelectorAll('.sticker')]
const home = new Map(stickers.map((s) => [s.dataset.k, { x: s.style.getPropertyValue('--x'), y: s.style.getPropertyValue('--y'), r: s.style.getPropertyValue('--r') }]))
const saved = store.get('panes-stickers') || {}
const place = (s, p) => {
  s.style.setProperty('--x', p.x)
  s.style.setProperty('--y', p.y)
  s.style.setProperty('--r', p.r)
}
for (const s of stickers) if (saved[s.dataset.k]) place(s, saved[s.dataset.k])
const moved = () => Object.keys(store.get('panes-stickers') || {}).length > 0
const showReset = () => {
  reset.hidden = !moved()
  say.textContent = moved() ? 'Stuck where you left them.' : "Go on, move one. It'll stay where you leave it."
}
showReset()
setTimeout(() => hint.classList.add('on'), 2200)

for (const s of stickers) {
  s.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    s.setPointerCapture(e.pointerId)
    s.classList.remove('back')
    s.classList.add('held')
    const h = hero.getBoundingClientRect()
    const r = s.getBoundingClientRect()
    const ox = e.clientX - (r.left + r.width / 2)
    const oy = e.clientY - (r.top + r.height / 2)
    let lastX = e.clientX
    const move = (ev) => {
      const x = ((ev.clientX - ox - h.left) / h.width) * 100
      const y = ((ev.clientY - oy - h.top) / h.height) * 100
      s.style.setProperty('--x', `${Math.min(98, Math.max(2, x)).toFixed(2)}%`)
      s.style.setProperty('--y', `${Math.min(96, Math.max(4, y)).toFixed(2)}%`)
      // a little lean in the direction it's carried
      const lean = Math.max(-18, Math.min(18, (ev.clientX - lastX) * 1.2))
      lastX = ev.clientX
      s.style.setProperty('--r', `${(parseFloat(home.get(s.dataset.k).r) + lean).toFixed(1)}deg`)
    }
    const up = () => {
      s.classList.remove('held')
      s.removeEventListener('pointermove', move)
      s.removeEventListener('pointerup', up)
      s.removeEventListener('pointercancel', up)
      const tilt = (Math.random() * 24 - 12).toFixed(1)
      s.style.setProperty('--r', `${tilt}deg`)
      const all = store.get('panes-stickers') || {}
      all[s.dataset.k] = { x: s.style.getPropertyValue('--x'), y: s.style.getPropertyValue('--y'), r: `${tilt}deg` }
      store.set('panes-stickers', all)
      showReset()
    }
    s.addEventListener('pointermove', move)
    s.addEventListener('pointerup', up)
    s.addEventListener('pointercancel', up)
  })
}
reset.addEventListener('click', () => {
  for (const s of stickers) {
    s.classList.add('back')
    place(s, home.get(s.dataset.k))
  }
  store.set('panes-stickers', null)
  showReset()
})

// ---------- What's inside: vertical tabs ----------
const tabs = [...document.querySelectorAll('.vtab')]
const panelsEl = document.querySelector('.panels')
for (const t of tabs) {
  const p = document.getElementById(t.getAttribute('aria-controls'))
  t.querySelector('.count').textContent = p.querySelectorAll('.ways li').length
  p.querySelectorAll('.blurb, .ways li').forEach((el, i) => el.style.setProperty('--i', String(i)))
}
const choose = (t, focus) => {
  if (t.getAttribute('aria-selected') === 'true') return
  const from = panelsEl.offsetHeight
  for (const o of tabs) {
    const on = o === t
    o.setAttribute('aria-selected', String(on))
    o.tabIndex = on ? 0 : -1
    document.getElementById(o.getAttribute('aria-controls')).classList.toggle('on', on)
  }
  if (focus) t.focus()
  if (reduced) return
  // The board eases to the new list's height instead of jumping
  const to = panelsEl.offsetHeight
  panelsEl.style.height = `${from}px`
  panelsEl.classList.add('easing')
  requestAnimationFrame(() => {
    panelsEl.style.height = `${to}px`
  })
  const done = () => {
    panelsEl.classList.remove('easing')
    panelsEl.style.height = ''
    panelsEl.removeEventListener('transitionend', done)
  }
  panelsEl.addEventListener('transitionend', done)
}
tabs.forEach((t, i) => {
  t.tabIndex = i === 0 ? 0 : -1
  t.addEventListener('click', () => choose(t))
  t.addEventListener('keydown', (e) => {
    const k = e.key
    let n = -1
    if (k === 'ArrowDown' || k === 'ArrowRight') n = (i + 1) % tabs.length
    else if (k === 'ArrowUp' || k === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length
    else if (k === 'Home') n = 0
    else if (k === 'End') n = tabs.length - 1
    if (n < 0) return
    e.preventDefault()
    choose(tabs[n], true)
  })
})
