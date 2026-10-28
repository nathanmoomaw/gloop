import { useCallback, useRef } from 'react'
import './SoundButton.css'

/**
 * One-shot "make it audible" reset (see src/audio/sound.js) — not a toggle,
 * so it's a squircle with a press flash rather than another round lamp
 * like listen/on beside it.
 */
export default function SoundButton({ onSound }) {
  const btnRef = useRef(null)

  const handleClick = useCallback(() => {
    const el = btnRef.current
    if (el) {
      el.classList.remove('sound-button--flash')
      // Force reflow so the flash restarts on rapid presses.
      void el.offsetWidth
      el.classList.add('sound-button--flash')
    }
    onSound()
  }, [onSound])

  return (
    <button
      ref={btnRef}
      type="button"
      className="sound-button"
      onClick={handleClick}
      title="Pull the dials into an audible range and start listening + playing"
      aria-label="Sound: reset to audible settings and start"
    >
      sound
    </button>
  )
}
