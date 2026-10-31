import { FEEDBACK, FEEDBACK_BY_ID } from '../audio/learn'
import './LearnPanel.css'

/**
 * Floating feedback bar for learn mode: four thumb-friendly buttons log how
 * the current settings sound and steer the `sound` reset toward what worked.
 */
export default function LearnPanel({
  summary,
  lastKind,
  pulse,
  onFeedback,
  onExport,
  onClose,
  fileSupported,
  fileName,
  fileError,
  onPickFile,
  remote,
}) {
  const total = summary?.total ?? 0
  const byKind = summary?.byKind ?? { heart: 0, sound: 0, muted: 0, star: 0 }
  const lastFeedback = lastKind ? FEEDBACK_BY_ID[lastKind] : null

  return (
    <div className="learn-panel" role="region" aria-label="Learn mode">
      {lastFeedback && (
        <span key={pulse} className="learn-panel__float" aria-hidden="true">
          {lastFeedback.emoji}
        </span>
      )}
      <div className="learn-panel__header">
        <span className="learn-panel__title">learn</span>
        <span className="learn-panel__count">{total} logged</span>
        <button
          type="button"
          className="learn-panel__action"
          onClick={onExport}
          disabled={total === 0}
        >
          export
        </button>
        <button
          type="button"
          className="learn-panel__close"
          onClick={onClose}
          aria-label="Close learn mode"
        >
          ×
        </button>
      </div>
      <div className="learn-panel__grid">
        {FEEDBACK.map(({ id, emoji, label }) => {
          const isLast = id === lastKind
          const count = byKind[id] ?? 0
          return (
            <button
              key={id}
              type="button"
              className="learn-panel__btn"
              onClick={() => onFeedback(id)}
              aria-label={`Log: ${label}`}
            >
              <span className="learn-panel__badge">{count}</span>
              <span
                key={isLast ? pulse : 'idle'}
                className={`learn-panel__emoji ${isLast ? 'learn-panel__btn--pop' : ''}`}
                aria-hidden="true"
              >
                {emoji}
              </span>
              <span className="learn-panel__label">{label}</span>
            </button>
          )
        })}
      </div>
      <p className="learn-panel__hint">🔇 also nudges the dials back toward what you liked</p>
      {fileSupported && (
        <p className={`learn-panel__file ${fileError ? 'learn-panel__file--error' : ''}`}>
          {fileName ? (
            <>
              auto-saving to <strong>{fileName}</strong>
              {fileError && <> · {fileError}</>}
            </>
          ) : (
            'saved in this browser'
          )}
          <button type="button" className="learn-panel__action" onClick={onPickFile}>
            {fileName ? 'change file' : 'auto-save to file'}
          </button>
        </p>
      )}
      {remote && <p className="learn-panel__file">also saved to the gloop learn store</p>}
    </div>
  )
}
