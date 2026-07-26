import { useCallback } from 'react'
import './MicModeToggle.css'

/**
 * A/B switch between the browser's default mic processing (echoCancellation/
 * noiseSuppression/autoGainControl all on) and a raw, unprocessed capture
 * path — noise suppression's gating in particular is the leading suspect
 * for "choppy, cuts off" reports, but disabling this by default previously
 * caused a worse regression (near-total silence on some hardware/backends),
 * so it's opt-in and user-toggleable instead of assumed. Only applies the
 * next time listening starts — getUserMedia constraints are fixed for the
 * life of a MediaStream, so toggling mid-session doesn't retroactively
 * change an already-open one.
 */
export default function MicModeToggle({ active, onToggle }) {
  const handleClick = useCallback(() => onToggle(!active), [active, onToggle])

  return (
    <button
      type="button"
      className={`mic-mode-toggle ${active ? 'mic-mode-toggle--active' : ''}`}
      onClick={handleClick}
      title={
        active
          ? 'Raw mic capture is on (no echo/noise/gain processing) — tap for default processing. Applies next time listening starts.'
          : 'Default mic processing is on — tap for raw, unprocessed capture. Applies next time listening starts.'
      }
      aria-pressed={active}
      aria-label="Toggle raw microphone capture"
    >
      raw
    </button>
  )
}
