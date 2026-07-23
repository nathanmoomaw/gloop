import './ListenButton.css'

/**
 * Large circular "listen" toggle — the centerpiece control. Not a knob:
 * a single tap starts/stops the mic and the whole feedback loop.
 */
export default function ListenButton({ running, onToggle, size = 128 }) {
  return (
    <button
      className={`listen-button ${running ? 'listen-button--on' : ''}`}
      style={{ '--listen-size': `${size}px` }}
      onClick={onToggle}
      aria-pressed={running}
      aria-label={running ? 'Stop listening' : 'Start listening'}
    >
      <span className="listen-button__ring" />
      <span className="listen-button__core">
        <span className="listen-button__label">
          {running ? 'listening' : 'listen'}
        </span>
      </span>
    </button>
  )
}
