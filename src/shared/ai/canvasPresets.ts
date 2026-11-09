import { addFrame, boundsOf, freeSpot, type Box, type CanvasState } from './canvas'
import { contentBoxes } from './canvasMarks'

/**
 * Ready-made boards: a row of named sections for a kind of task. The assistant fills them from a prompt ("Lisbon in
 * May"); without AI they are just the empty sections. Pure.
 */
export type PresetId = 'research' | 'trip' | 'shopping'
export const PRESETS: Record<PresetId, { label: string; frames: string[]; ask: string }> = {
  research: {
    label: 'Research',
    frames: ['Sources', 'Key points', 'Open questions', 'Summary'],
    ask: 'Find good sources, pull out the key points, list what is still unclear, and write a short summary'
  },
  trip: {
    label: 'Trip',
    frames: ['Getting there', 'Places to stay', 'Things to do', 'Food', 'Budget'],
    ask: 'Plan the trip: how to get there, where to stay, what to do, where to eat, and a rough budget'
  },
  shopping: {
    label: 'Shopping',
    frames: ['Options', 'Compare', 'Reviews', 'Decision'],
    ask: 'Find the main options, compare them on what matters, sum up what reviews say, and suggest one'
  }
}
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[]

const W = 560
const H = 420
const GAP = 48

/** The preset's sections in a row, in free space near `near`; returns their ids in order. */
export function addPreset(
  s: CanvasState,
  id: PresetId,
  near: { x: number; y: number }
): { state: CanvasState; ids: string[] } {
  const names = PRESETS[id].frames
  const row = { w: names.length * W + (names.length - 1) * GAP, h: H }
  const at = freeSpot(row, contentBoxes(s), near, 64)
  let st = s
  const ids: string[] = []
  names.forEach((name, i) => {
    const r = addFrame(st, { x: at.x + i * (W + GAP), y: at.y, w: W, h: H }, name)
    // sized: an empty section keeps its room instead of hugging nothing
    st = {
      ...r.state,
      frames: r.state.frames.map((f) => (f.id === r.id ? { ...f, sized: true } : f))
    }
    ids.push(r.id)
  })
  return { state: st, ids }
}

/** What the assistant is asked, so it fills each section with notes and pages (by the ids it can use). */
export function presetAsk(
  id: PresetId,
  topic: string,
  frames: ReadonlyArray<{ id: string; name: string }>
): string {
  const list = frames.map((f) => `"${f.name}" (${f.id})`).join(', ')
  return `${PRESETS[id].ask} for: ${topic.trim()}. Put your findings on the board inside the sections ${list}: use add_note and add_card with near set to the section's id, a few short notes per section.`
}

/** The box around the preset's sections, to show them. */
export const presetBox = (s: CanvasState, ids: readonly string[]): Box | null =>
  boundsOf(s.frames.filter((f) => ids.includes(f.id)))
