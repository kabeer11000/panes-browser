// Scroll reveal
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in')
        io.unobserve(e.target)
      }
    }
  },
  { threshold: 0.15 }
)
document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 4) * 70}ms`
  io.observe(el)
})

// Hero: alternate one pane / split, moving the active tab highlight with it
const win = document.getElementById('heroWin')
const tabs = [...document.querySelectorAll('#heroTabs .tab:not(.ghost)')]
const setMode = (split) => {
  win.dataset.mode = split ? 'split' : 'one'
  tabs[0].classList.toggle('on', true)
  tabs[1].classList.toggle('on', split)
}
let split = false
setInterval(() => setMode((split = !split)), 3800)

// Hero: gentle 3D tilt following the pointer
const stage = document.getElementById('stage')
stage.addEventListener('pointermove', (e) => {
  const r = stage.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width - 0.5
  const y = (e.clientY - r.top) / r.height - 0.5
  win.style.setProperty('--tilt-y', `${x * 5}deg`)
  win.style.setProperty('--tilt-x', `${-y * 4}deg`)
})
stage.addEventListener('pointerleave', () => {
  win.style.setProperty('--tilt-y', '0deg')
  win.style.setProperty('--tilt-x', '0deg')
})

// Split demo: draggable + keyboard-resizable divider
const demo = document.getElementById('splitDemo')
const handle = document.getElementById('splitHandle')
const setSplit = (pct) => {
  const v = Math.min(75, Math.max(25, pct))
  demo.style.setProperty('--split', `${v}%`)
  handle.setAttribute('aria-valuenow', String(Math.round(v)))
}
handle.addEventListener('pointerdown', (e) => {
  handle.setPointerCapture(e.pointerId)
  demo.classList.add('drag')
})
handle.addEventListener('pointermove', (e) => {
  if (!demo.classList.contains('drag')) return
  const r = demo.getBoundingClientRect()
  setSplit(((e.clientX - r.left) / r.width) * 100)
})
const endDrag = () => demo.classList.remove('drag')
handle.addEventListener('pointerup', endDrag)
handle.addEventListener('pointercancel', endDrag)
handle.addEventListener('keydown', (e) => {
  const cur = Number(handle.getAttribute('aria-valuenow'))
  if (e.key === 'ArrowLeft') setSplit(cur - 4)
  else if (e.key === 'ArrowRight') setSplit(cur + 4)
  else return
  e.preventDefault()
})

// Tab stack: fan out when scrolled into view on touch devices (no hover)
if (!matchMedia('(hover: hover)').matches) {
  const stackEl = document.getElementById('stackDemo')
  new IntersectionObserver(([e]) => stackEl.classList.toggle('on', e.isIntersecting), {
    threshold: 0.6
  }).observe(stackEl)
}
