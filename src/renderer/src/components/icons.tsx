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
export const SiteIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M2 5h6M12 5h2M2 11h2M8 11h6" />
    <circle cx="10" cy="5" r="1.7" />
    <circle cx="6" cy="11" r="1.7" />
  </Svg>
)
export const ChevronIcon = (): React.JSX.Element => (
  <Svg size={12}>
    <path d="M5 6.5 8 9.5 11 6.5" />
  </Svg>
)
export const SpeakerIcon = ({ muted = false }: { muted?: boolean }): React.JSX.Element => (
  <Svg>
    <path d="M2.5 6.2h2.3L8 3.5v9L4.8 9.8H2.5z" />
    {muted ? (
      <path d="M10.6 6.2l3 3.6M13.6 6.2l-3 3.6" />
    ) : (
      <path d="M10.6 6a3 3 0 0 1 0 4M12.2 4.3a5.4 5.4 0 0 1 0 7.4" />
    )}
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
export const MoreIcon = (): React.JSX.Element => (
  <Svg>
    <circle cx="3.5" cy="8" r="1" />
    <circle cx="8" cy="8" r="1" />
    <circle cx="12.5" cy="8" r="1" />
  </Svg>
)
export const KeyIcon = (): React.JSX.Element => (
  <Svg>
    <circle cx="5.5" cy="10.5" r="2.5" />
    <path d="M7.3 8.7 13 3m-2 2 1.8 1.8M9.3 6.7l1.4 1.4" />
  </Svg>
)
export const SoftwareIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M2.5 5.2 8 2.5l5.5 2.7v5.6L8 13.5l-5.5-2.7zM2.5 5.2 8 8l5.5-2.8M8 8v5.5" />
  </Svg>
)
export const EyeIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8Z" />
    <circle cx="8" cy="8" r="1.9" />
  </Svg>
)
export const EyeOffIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M2.6 2.6l10.8 10.8M6.5 4c.5-.1 1-.2 1.5-.2 4 0 6.2 4.2 6.2 4.2s-.6 1.1-1.7 2.2M4.6 5.2C2.9 6.4 1.8 8 1.8 8s2.2 4.2 6.2 4.2c1 0 1.9-.3 2.6-.7" />
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
export const PipIcon = (): React.JSX.Element => (
  <Svg>
    <rect x="2" y="3.5" width="12" height="9" rx="2" />
    <rect x="8" y="7.6" width="4.6" height="3.2" rx="0.9" fill="currentColor" stroke="none" />
  </Svg>
)
