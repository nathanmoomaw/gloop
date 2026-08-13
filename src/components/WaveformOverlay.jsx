import { useEffect, useRef } from 'react'
import './WaveformOverlay.css'

// Playful wobble riding on top of the real waveform trace — a slow
// traveling sine added to each sample's y position, distinct from the
// audio-engine's own wow/flutter (those modulate playback, this is purely
// cosmetic). WOBBLE_CYCLES is how many wobble humps fit across the width at
// any instant; the phase also advances with time so the humps visibly
// travel sideways rather than just bobbing in place.
const WOBBLE_HZ = 0.5
const WOBBLE_CYCLES = 2.5
const WOBBLE_AMPLITUDE_RATIO = 0.02 // fraction of canvas height

// A second visual layer over the plate: the live time-domain waveform of
// what's actually reaching the output (analyser is tapped from masterGain,
// so this is the looped-back grain/delay mix, not just the raw mic input).
// Deliberately separate from the Chladni/grain visuals below it — a direct
// "what you're hearing right now" trace rather than an abstracted pattern.
export default function WaveformOverlay({ analyser, running }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx2d = canvas.getContext('2d')
    const dataArray = analyser ? new Uint8Array(analyser.fftSize) : null
    const startTime = performance.now()

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    let raf
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      ctx2d.clearRect(0, 0, w, h)

      if (!running || !analyser) return

      analyser.getByteTimeDomainData(dataArray)
      const t = (performance.now() - startTime) / 1000
      const wobbleAmplitude = h * WOBBLE_AMPLITUDE_RATIO

      const gradient = ctx2d.createLinearGradient(0, 0, w, 0)
      gradient.addColorStop(0, '#ff4d6d')
      gradient.addColorStop(0.2, '#ff9f4d')
      gradient.addColorStop(0.4, '#ffe14d')
      gradient.addColorStop(0.6, '#4dff88')
      gradient.addColorStop(0.8, '#4dc9ff')
      gradient.addColorStop(1, '#b04dff')

      ctx2d.lineWidth = 2.5
      ctx2d.strokeStyle = gradient
      ctx2d.shadowColor = '#4dc9ff'
      ctx2d.shadowBlur = 12
      ctx2d.lineJoin = 'round'
      ctx2d.beginPath()

      const sliceWidth = w / dataArray.length
      let x = 0
      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128 - 1 // -1..1
        const wobble = Math.sin((x / w) * WOBBLE_CYCLES * Math.PI * 2 + t * WOBBLE_HZ * Math.PI * 2) * wobbleAmplitude
        const y = h / 2 + v * (h / 2) * 0.92 + wobble
        if (i === 0) ctx2d.moveTo(x, y)
        else ctx2d.lineTo(x, y)
        x += sliceWidth
      }
      ctx2d.stroke()
    }
    draw()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [analyser, running])

  return (
    <div className={`waveform-overlay ${running ? 'waveform-overlay--active' : ''}`}>
      <canvas ref={canvasRef} className="waveform-overlay__canvas" />
    </div>
  )
}
