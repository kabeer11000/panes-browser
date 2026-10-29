import './pip.css'
import type { PipApi, PipState } from '../../../shared/types'

declare global {
  interface Window {
    pip: PipApi
  }
}

const DRAG_THRESHOLD = 4 // px before a press becomes a window drag instead of a click
const SKIP_SECONDS = 10

const ICONS = {
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  back: '<path d="M9.5 3.5H5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 5 12.5h6a1.5 1.5 0 0 0 1.5-1.5V7M7.5 8.5l5-5M9 3.5h3.5V7"/>',
  play: '<path d="M5.5 3.8v8.4a.5.5 0 0 0 .77.42l6.4-4.2a.5.5 0 0 0 0-.84l-6.4-4.2a.5.5 0 0 0-.77.42z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="4.6" y="3.4" width="2.4" height="9.2" rx=".8" fill="currentColor" stroke="none"/><rect x="9" y="3.4" width="2.4" height="9.2" rx=".8" fill="currentColor" stroke="none"/>',
  back10: '<path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.2M3.5 3v2.4h2.4"/>',
  fwd10: '<path d="M12.5 8a4.5 4.5 0 1 1-1.4-3.2M12.5 3v2.4h-2.4"/>',
  volume: '<path d="M3 6.2v3.6h2.4L8.5 12.2V3.8L5.4 6.2zM10.8 5.6a3.4 3.4 0 0 1 0 4.8"/>',
  muted: '<path d="M3 6.2v3.6h2.4L8.5 12.2V3.8L5.4 6.2zM11 6l3 4M14 6l-3 4"/>'
}

const svg = (body: string, size = 16): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

const root = document.getElementById('root') as HTMLElement
root.innerHTML = `
  <div class="pip" id="surface">
    <div class="shade top"></div>
    <div class="shade bottom"></div>
    <button class="round corner left" id="close" aria-label="Close" title="Close">${svg(ICONS.close)}</button>
    <button class="round corner right" id="back" aria-label="Back to tab" title="Back to tab">${svg(ICONS.back)}</button>
    <div class="transport">
      <button class="plain" id="skip-back" aria-label="Back ${SKIP_SECONDS} seconds" title="Back ${SKIP_SECONDS} seconds">${svg(ICONS.back10, 26)}</button>
      <button class="plain big" id="toggle" aria-label="Play or pause">${svg(ICONS.play, 34)}</button>
      <button class="plain" id="skip-fwd" aria-label="Forward ${SKIP_SECONDS} seconds" title="Forward ${SKIP_SECONDS} seconds">${svg(ICONS.fwd10, 26)}</button>
    </div>
    <div class="bar">
      <span class="time" id="current">0:00</span>
      <input class="scrub" id="scrub" type="range" min="0" max="1" step="0.1" value="0" aria-label="Seek" />
      <span class="time" id="remaining">-0:00</span>
      <button class="plain small" id="mute" aria-label="Mute" title="Mute">${svg(ICONS.volume)}</button>
    </div>
  </div>`

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const surface = $('surface')
const toggle = $('toggle')
const scrub = $<HTMLInputElement>('scrub')
const mute = $('mute')

const fmt = (s: number): string => {
  const t = Math.max(0, Math.floor(s))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

let scrubbing = false
let playing = false

function render(s: PipState): void {
  if (s.playing !== playing || !toggle.innerHTML) {
    playing = s.playing
    toggle.innerHTML = svg(playing ? ICONS.pause : ICONS.play, 34)
  }
  mute.innerHTML = svg(s.muted ? ICONS.muted : ICONS.volume)
  if (!scrubbing) {
    scrub.max = String(s.duration || 1)
    scrub.value = String(s.current)
    scrub.style.setProperty('--progress', `${s.duration ? (s.current / s.duration) * 100 : 0}%`)
  }
  $('current').textContent = fmt(s.current)
  $('remaining').textContent = s.duration ? `-${fmt(s.duration - s.current)}` : 'live'
  scrub.disabled = !s.duration
}

window.pip.onState(render)

// A press on the picture either drags the window or, if it never moved, plays or pauses.
let press: { x: number; y: number; moved: boolean } | null = null
surface.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button, input')) return
  press = { x: e.screenX, y: e.screenY, moved: false }
  surface.setPointerCapture(e.pointerId)
})
surface.addEventListener('pointermove', (e) => {
  if (!press) return
  if (!press.moved && Math.hypot(e.screenX - press.x, e.screenY - press.y) > DRAG_THRESHOLD) {
    press.moved = true
    window.pip.drag('start')
  }
  if (press.moved) window.pip.drag('move')
})
surface.addEventListener('pointerup', () => {
  if (!press) return
  if (press.moved) window.pip.drag('end')
  else window.pip.playPause()
  press = null
})

toggle.addEventListener('click', () => window.pip.playPause())
$('skip-back').addEventListener('click', () => window.pip.skip(-SKIP_SECONDS))
$('skip-fwd').addEventListener('click', () => window.pip.skip(SKIP_SECONDS))
$('close').addEventListener('click', () => window.pip.close())
$('back').addEventListener('click', () => window.pip.back())
mute.addEventListener('click', () => window.pip.toggleMute())

scrub.addEventListener('pointerdown', () => (scrubbing = true))
scrub.addEventListener('input', () => {
  scrub.style.setProperty('--progress', `${(Number(scrub.value) / Number(scrub.max)) * 100}%`)
  window.pip.seek(Number(scrub.value))
})
scrub.addEventListener('change', () => (scrubbing = false))

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') window.pip.playPause()
  else if (e.key === 'ArrowLeft') window.pip.skip(-5)
  else if (e.key === 'ArrowRight') window.pip.skip(5)
  else if (e.key === 'Escape') window.pip.close()
  else return
  e.preventDefault()
})
