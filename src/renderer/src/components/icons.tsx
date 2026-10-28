import type { ReactNode } from 'react'

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
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

export const BackIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M9.5 3.5 5 8l4.5 4.5" />
  </Svg>
)
export const ForwardIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M6.5 3.5 11 8l-4.5 4.5" />
  </Svg>
)
export const ReloadIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M13 8a5 5 0 1 1-1.5-3.55M13 2.5v2.6h-2.6" />
  </Svg>
)
export const StopIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
)
export const CloseIcon = (): React.JSX.Element => (
  <Svg size={12}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
)
export const PlusIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M8 3v10M3 8h10" />
  </Svg>
)
export const SidebarIcon = (): React.JSX.Element => (
  <Svg>
    <rect x="2" y="3" width="12" height="10" rx="2.5" />
    <path d="M6 3v10" />
  </Svg>
)
export const GridIcon = (): React.JSX.Element => (
  <Svg>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1.2" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1.2" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1.2" />
  </Svg>
)
export const GlobeIcon = (): React.JSX.Element => (
  <Svg>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M2.5 8h11M8 2.5c2 1.8 2 9.2 0 11M8 2.5c-2 1.8-2 9.2 0 11" />
  </Svg>
)
export const SearchIcon = (): React.JSX.Element => (
  <Svg>
    <circle cx="7" cy="7" r="4.2" />
    <path d="m10.2 10.2 3 3" />
  </Svg>
)
export const SplitIcon = (): React.JSX.Element => (
  <Svg>
    <rect x="2" y="3" width="5.2" height="10" rx="1.8" />
    <rect x="8.8" y="3" width="5.2" height="10" rx="1.8" />
  </Svg>
)
export const SwapIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M3 5.8h9.5l-2.2-2.2M13 10.2H3.5l2.2 2.2" />
  </Svg>
)
export const StarIcon = ({ filled = false }: { filled?: boolean }): React.JSX.Element => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 10.9l-3.5 2 .8-3.9L2.4 6.3l3.9-.5z" />
  </svg>
)
export const BookmarkIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M4.5 2.5h7v11L8 10.8l-3.5 2.7z" />
  </Svg>
)
export const HistoryIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4M2.5 2.8v2.6h2.6M8 5v3.3l2 1.2" />
  </Svg>
)
export const DownloadIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M8 2.5v7.5M5 7.3 8 10.3l3-3M3 13h10" />
  </Svg>
)
export const SettingsIcon = (): React.JSX.Element => (
  <Svg>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
  </Svg>
)
export const ChevronUpIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M4 10l4-4 4 4" />
  </Svg>
)
export const ChevronDownIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M4 6l4 4 4-4" />
  </Svg>
)
export const GripIcon = (): React.JSX.Element => (
  <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
    <circle cx="3" cy="3" r="1.1" />
    <circle cx="7" cy="3" r="1.1" />
    <circle cx="3" cy="7" r="1.1" />
    <circle cx="7" cy="7" r="1.1" />
    <circle cx="3" cy="11" r="1.1" />
    <circle cx="7" cy="11" r="1.1" />
  </svg>
)
