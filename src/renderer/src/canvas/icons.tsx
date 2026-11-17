import type { ReactNode } from 'react'

function Svg({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const SelectIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3.8 2.6 12.6 8l-3.9 1-1.7 3.8Z" />
  </Svg>
)
export const HandIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M5.2 8.2V3.9a1 1 0 0 1 2 0V7M7.2 6.6V2.9a1 1 0 0 1 2 0V7M9.2 6.8V3.7a1 1 0 0 1 2 0V8.6M11.2 7.4a1 1 0 0 1 2 0V10c0 2.4-1.6 4-4 4H8a3.4 3.4 0 0 1-2.8-1.4L3 9.4a1 1 0 0 1 1.6-1.2l.6.7" />
  </Svg>
)
export const FrameIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M5 2.4v11.2M11 2.4v11.2M2.4 5h11.2M2.4 11h11.2" />
  </Svg>
)
export const NoteIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3.4 2.6h9.2a.8.8 0 0 1 .8.8v6.2L9.6 13.4H3.4a.8.8 0 0 1-.8-.8V3.4a.8.8 0 0 1 .8-.8Z" />
    <path d="M9.4 13.4V10.2a.6.6 0 0 1 .6-.6h3.2" />
  </Svg>
)
/** Tidy up: a few sparks. */
export const TidyIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M6.2 2.6 7.3 5.4 10 6.5 7.3 7.6 6.2 10.4 5.1 7.6 2.4 6.5 5.1 5.4Z" />
    <path d="M11.6 9.4l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6Z" />
  </Svg>
)
export const ExpandIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M9.4 2.8h3.8v3.8M6.6 13.2H2.8V9.4M13.2 2.8 9 7M2.8 13.2 7 9" />
  </Svg>
)
export const PlayIcon = (): React.JSX.Element => (
  <svg width={22} height={22} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M5.6 3.6v8.8a.6.6 0 0 0 .92.5l7-4.4a.6.6 0 0 0 0-1l-7-4.4a.6.6 0 0 0-.92.5Z" />
  </svg>
)
export const MiniPlayIcon = (): React.JSX.Element => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M5 3.4v9.2a.6.6 0 0 0 .92.5l7.3-4.6a.6.6 0 0 0 0-1L5.92 2.9A.6.6 0 0 0 5 3.4Z" />
  </svg>
)
export const MiniPauseIcon = (): React.JSX.Element => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <rect x="3.8" y="3" width="3" height="10" rx="0.9" />
    <rect x="9.2" y="3" width="3" height="10" rx="0.9" />
  </svg>
)
export const LiveIcon = (): React.JSX.Element => (
  <Svg>
    <rect x="2" y="3" width="12" height="9" rx="2" />
    <path d="M5.4 14h5.2" />
  </Svg>
)
export const TabIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M2.5 5.6a2 2 0 0 1 2-2h2.4l1.2 1.4h3.4a2 2 0 0 1 2 2v4.4a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2Z" />
  </Svg>
)
export const SearchGlyph = (): React.JSX.Element => (
  <Svg>
    <circle cx="7" cy="7" r="4.2" />
    <path d="m10.2 10.2 3.2 3.2" />
  </Svg>
)
export const ConnectorIcon = (): React.JSX.Element => (
  <Svg>
    <circle cx="3.6" cy="12.4" r="1.4" />
    <path d="M4.8 11.2C7 6 9 5 12.6 3.4" />
    <path d="M9.8 3 12.8 3.3 11.9 6.2" />
  </Svg>
)
export const StraightIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3 13 13 3" />
  </Svg>
)
export const CurvedIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3 13C3 7 13 9 13 3" />
  </Svg>
)
export const ElbowIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3 13H8V3H13" />
  </Svg>
)
export const ArrowNoneIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M2.6 8h10.8" />
  </Svg>
)
export const ArrowEndIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M2.6 8h10.4M10 5l3 3-3 3" />
  </Svg>
)
export const ArrowBothIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3 8h10M10 5l3 3-3 3M6 5 3 8l3 3" />
  </Svg>
)
export const LabelIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3.4 4.2h9.2M8 4.2v8.4M6.2 12.6h3.6" />
  </Svg>
)
/** Two panes pulled apart: take a split view back to separate tabs. */
export const UnsplitIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M2 4.5a1 1 0 0 1 1-1h2.6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1zM9.4 4.5a1 1 0 0 1 1-1H13a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2.6a1 1 0 0 1-1-1z" />
  </Svg>
)
export const TrashIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3 4.4h10M6.4 4.4V3.2h3.2v1.2M4.4 4.4l.6 8.4h6l.6-8.4" />
  </Svg>
)
export const ReaderIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3.4 3.4h9.2M3.4 6.4h9.2M3.4 9.4h9.2M3.4 12.4h5.6" />
  </Svg>
)
export const SnapshotIcon = (): React.JSX.Element => (
  <Svg>
    <rect x="2.4" y="3" width="11.2" height="10" rx="1.6" />
    <path d="m2.8 11 3.4-3.2 2.6 2.4 1.8-1.6 2.8 2.6" />
  </Svg>
)
export const BackIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M9.6 3.6 5.2 8l4.4 4.4" />
  </Svg>
)
export const PenIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3 13l.8-3L11 2.8a1.4 1.4 0 0 1 2 0l.2.2a1.4 1.4 0 0 1 0 2L6 12.2Z" />
    <path d="M9.6 4.2l2.2 2.2" />
  </Svg>
)
export const MarkerIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M9 3.2l3.8 3.8-4.6 4.6H4.4V8.8Z" />
    <path d="M3 14h10" />
  </Svg>
)
export const ShapeIcon = (): React.JSX.Element => (
  <Svg>
    <rect x="2" y="7" width="6.2" height="6.2" rx="1" />
    <circle cx="10.6" cy="5.6" r="3.2" />
  </Svg>
)
export const TextIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3.4 4.6V3.4h9.2v1.2M8 3.4v9.2M6 12.6h4" />
  </Svg>
)
export const LineIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3.2 12.8 12.8 3.2" />
  </Svg>
)
export const BlockIcon = (): React.JSX.Element => (
  <Svg>
    <rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.6" />
    <path d="M2.4 6.2h11.2M6.6 6.2v7.4" />
  </Svg>
)
export const GearIcon = (): React.JSX.Element => (
  <Svg>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
  </Svg>
)
export const TableIcon = (): React.JSX.Element => (
  <Svg>
    <rect x="2.4" y="3" width="11.2" height="10" rx="1.6" />
    <path d="M2.4 6.6h11.2M2.4 9.8h11.2M6.2 6.6V13M9.8 6.6V13" />
  </Svg>
)
export const DocIcon = (): React.JSX.Element => (
  <Svg>
    <rect x="3.4" y="2" width="9.2" height="12" rx="1.6" />
    <path d="M5.8 5.4h4.4M5.8 8h4.4M5.8 10.6h2.6" />
  </Svg>
)
export const PlusIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M8 3.4v9.2M3.4 8h9.2" />
  </Svg>
)
/** Shapes and connectors, as one cluster: a square, a circle, and an arrow bending between them. */
export const ShapeClusterIcon = (): React.JSX.Element => (
  <svg
    width={30}
    height={30}
    viewBox="0 0 30 30"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2.5" y="9.5" width="11" height="11" rx="1.5" />
    <circle cx="22" cy="22.5" r="5.5" />
    <path d="M17 13.5V8.5a3 3 0 0 1 3-3h6.5M24 3l2.5 2.5L24 8" />
  </svg>
)
/** The pencil as an object, standing in the bar (it peeks up from the bar's floor). `tip` colours the lead. */
export const PencilArt = ({ tip = '#2a2a2e' }: { tip?: string }): React.JSX.Element => (
  <svg width={26} height={62} viewBox="0 0 26 62" aria-hidden="true">
    <defs>
      <linearGradient id="pa-body" x1="0" x2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.55" stopColor="#f3f3f5" />
        <stop offset="1" stopColor="#d9d9de" />
      </linearGradient>
      <linearGradient id="pa-cone" x1="0" x2="1">
        <stop offset="0" stopColor="#fbfbfc" />
        <stop offset="1" stopColor="#d6d6dc" />
      </linearGradient>
    </defs>
    <path d="M4 24 13 4l9 20Z" fill="url(#pa-cone)" />
    <path d="M10.2 10.3 13 4l2.8 6.3c-1.8.8-3.8.8-5.6 0Z" fill={tip} />
    <rect x="4" y="24" width="18" height="40" rx="1.5" fill="url(#pa-body)" />
    <path d="M4 24h18" stroke="rgb(0 0 0 / .08)" />
    <rect x="4" y="24" width="18" height="40" rx="1.5" fill="none" stroke="rgb(0 0 0 / .1)" />
  </svg>
)
/** The highlighter as an object: a chisel tip and a coloured cap band. */
export const HighlighterArt = ({ ink = '#f7d23e' }: { ink?: string }): React.JSX.Element => (
  <svg width={26} height={62} viewBox="0 0 26 62" aria-hidden="true">
    <defs>
      <linearGradient id="ha-body" x1="0" x2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.55" stopColor="#f2f2f4" />
        <stop offset="1" stopColor="#d7d7dc" />
      </linearGradient>
    </defs>
    <path d="M8.5 5.5 17.5 3v9h-9Z" fill={ink} />
    <path d="M6 12h14l2 8H4Z" fill="url(#ha-body)" />
    <rect x="4" y="20" width="18" height="6" fill={ink} opacity="0.9" />
    <rect x="4" y="26" width="18" height="38" rx="1.5" fill="url(#ha-body)" />
    <rect x="4" y="20" width="18" height="44" rx="1.5" fill="none" stroke="rgb(0 0 0 / .1)" />
  </svg>
)
/** A pad of sticky notes, the top one with its corner lifting. */
export const StickyArt = ({ color = '#ffd966' }: { color?: string }): React.JSX.Element => (
  <svg width={54} height={56} viewBox="0 0 54 56" aria-hidden="true">
    <defs>
      <linearGradient id="sa-top" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={color} />
        <stop offset="1" stopColor={`color-mix(in srgb, ${color} 82%, #b8860b)`} />
      </linearGradient>
      <linearGradient id="sa-curl" x1="1" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor="#fff6cf" />
        <stop offset="1" stopColor={`color-mix(in srgb, ${color} 70%, #a87900)`} />
      </linearGradient>
    </defs>
    <rect
      x="9"
      y="8"
      width="38"
      height="50"
      rx="2"
      transform="rotate(6 28 33)"
      fill={`color-mix(in srgb, ${color} 80%, #c79a1e)`}
    />
    <rect
      x="7"
      y="7"
      width="38"
      height="50"
      rx="2"
      transform="rotate(-3 26 32)"
      fill={`color-mix(in srgb, ${color} 90%, #d4a52a)`}
    />
    <path d="M7 6h38a2 2 0 0 1 2 2v48H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" fill="url(#sa-top)" />
    <path d="M5 30c6 1 11 6 12 13-5-4-9-6-12-6Z" fill="url(#sa-curl)" opacity="0.9" />
  </svg>
)
