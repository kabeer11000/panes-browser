import { describe, expect, test } from 'bun:test'
import {
  cardBox,
  emptyState,
  intersects,
  syncTabs,
  tidy,
  type CanvasState,
  type TabLite
} from './canvas'

/** Pairs of cards that sit on each other (touching edges do not count). */
function overlaps(s: CanvasState): string[] {
  const out: string[] = []
  for (let i = 0; i < s.cards.length; i++)
    for (let j = i + 1; j < s.cards.length; j++)
      if (intersects(cardBox(s.cards[i]), cardBox(s.cards[j]), -1))
        out.push(`${s.cards[i].id}/${s.cards[j].id}`)
  return out
}

describe('tab cards never land on each other', () => {
  // A seeded walk through what happens to a board: tabs opened in bursts (some private), tabs closed, Tidy now and
  // then. Found: a section re-gridded after a tab closed (a tall column becoming two) covered the next section's cards.
  test('opening, closing and tidying in any order', () => {
    for (let run = 0; run < 300; run++) {
      let seed = run + 1
      const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
      let s = emptyState('b')
      let tabs: TabLite[] = []
      let next = 1
      for (let step = 0; step < 40; step++) {
        const r = rnd()
        if (r < 0.55) {
          const n = 1 + Math.floor(rnd() * 4)
          for (let k = 0; k < n; k++)
            tabs = [
              ...tabs,
              {
                id: next,
                url: `https://s${Math.floor(rnd() * 5)}.test/${next++}`,
                private: rnd() < 0.1
              }
            ]
        } else if (r < 0.8) tabs = tabs.filter(() => rnd() > 0.25)
        else if (r < 0.92) {
          const ids = tabs
            .filter((t) => !t.private)
            .filter((_, i) => i % 2 === 0)
            .map((t) => t.id)
          s = tidy(s, tabs, [{ name: 'a', ids }], rnd() < 0.5)
        }
        s = syncTabs(s, tabs).state
        const o = overlaps(s)
        if (o.length) throw new Error(`run ${run}, step ${step}: ${o.join(', ')}`)
      }
    }
    expect(true).toBe(true)
  })
})
