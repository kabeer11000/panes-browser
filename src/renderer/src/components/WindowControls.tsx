const glyph = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round'
} as const

/** Small mac-style dots on every platform; colours and glyphs appear on hover. */
export function WindowControls(): React.JSX.Element {
  return (
    <div className="winctl no-drag">
      <button className="wc close" onClick={window.api.closeWindow} aria-label="Close">
        <svg viewBox="0 0 8 8" {...glyph}>
          <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" />
        </svg>
      </button>
      <button className="wc min" onClick={window.api.minimizeWindow} aria-label="Minimize">
        <svg viewBox="0 0 8 8" {...glyph}>
          <path d="M1.5 4h5" />
        </svg>
      </button>
      <button className="wc max" onClick={window.api.toggleMaximizeWindow} aria-label="Maximize">
        <svg viewBox="0 0 8 8" {...glyph}>
          <path d="M1.8 1.8h4.4v4.4H1.8z" />
        </svg>
      </button>
    </div>
  )
}
