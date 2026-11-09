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
export const ChevronIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M4.5 6.5 8 10l3.5-3.5" />
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
