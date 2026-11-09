# Design tokens

One scale, defined at the top of `src/renderer/src/styles.css` (every window imports it; pip.css does not and keeps its own focus ring). Use the variable, not a literal.

| Group | Tokens | Use |
| --- | --- | --- |
| Radius | `--r-1` 4, `--r-2` 6, `--r-3` 8, `--r-4` 12, `--r-5` 16, `--r-6` 20, `--r-pill` | 4 chips and bars, 6-8 buttons and inputs, 12 cards and menus, 16 panels and dialogs, 20 hero tiles. `--radius-s/m/l` remain as aliases of 3/4/5. |
| Type | `--fs-xs` 11, `--fs-s` 12, `--fs-m` 13, `--fs-l` 14, `--fs-xl` 16, `--fs-2xl` 20 | 11 meta, 12 secondary and controls in dense popovers, 13 body, 14 row titles, 16+ headings. No half pixels. |
| Spacing | `--sp-1` 4, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-5` 24, `--sp-6` 32 | gaps and padding in new code. Existing rules are not migrated (many are scaled by `--d`). |
| Shadow | `--shadow-1`, `--shadow-2`, `--shadow-3` | 1 resting control, 2 menu or popover, 3 dialog or floating panel. Light scheme has its own values. |
| Motion | `--dur-fast` .14s, `--dur` .2s, `--dur-slow` .32s, `--ease` | hover and press, state change, layout and entrances. All three collapse to ~0 under prefers-reduced-motion, so a transition that uses them needs no extra media query. Looping animations (shimmer, orbs) keep literal durations and their own reduced-motion rule. |
| Focus | `--ring`, `--ring-offset` | `:focus-visible` only, 1.5px accent at 80%. The global rule covers everything; do not add per-component outlines. Text fields signal focus with a border or glow on `:focus-within`, not an outline. |

Rules
- New CSS uses tokens. A literal radius, font-size, shadow or transition duration needs a reason (geometry that must match a native size, a looped animation).
- Radius nests: an inner element is one step below its container (card 12, control inside 8).
- Surfaces keep their own colour variables (`--popover-bg`, `--card-bg`, `--overlay`); tokens here are shape, type, depth and motion only.
- Not migrated yet: multi-layer shadows (glass rims), canvas.css, ask.css, print.css, pip.css.
