import { useEffect, useRef } from 'react'
import './WaveformOverlay.css'

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
        const y = h / 2 + v * (h / 2) * 0.92
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
