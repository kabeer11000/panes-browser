import type { TabInfo } from '../../../shared/types'
import { BackIcon, ForwardIcon, ReloadIcon, StopIcon } from './icons'

export function NavButtons({ active }: { active: TabInfo | null }): React.JSX.Element {
  const loading = !!active?.loading
  return (
    <>
      <button
        className="icon-btn no-drag"
        disabled={!active?.canGoBack}
        onClick={window.api.back}
        title="Back (Alt+Left)"
      >
        <BackIcon />
      </button>
      <button
        className="icon-btn no-drag"
        disabled={!active?.canGoForward}
        onClick={window.api.forward}
        title="Forward (Alt+Right)"
      >
        <ForwardIcon />
      </button>
      <button
        className="icon-btn no-drag"
        disabled={!active?.url}
        onClick={loading ? window.api.stop : window.api.reload}
        title={loading ? 'Stop' : 'Reload (Ctrl+R)'}
      >
        {loading ? <StopIcon /> : <ReloadIcon />}
      </button>
    </>
  )
}
