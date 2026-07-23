import { useEffect, useRef } from 'react'

// Renders rainbow "sand" grains settling into Chladni-plate-style nodal
// patterns driven by the dominant frequency of the live audio analyser.
//
// Pointer interaction: clicking/dragging the canvas pushes nearby grains
// (visual only, cheap — read via a mutable ref inside the rAF loop so it
// never triggers a React re-render) and calls `onInteract` so the caller
// can feed the same gesture into the audio engine as a temporary perturbation.
export default function GrainField({ analyser, running, onInteract }) {
  const canvasRef = useRef(null)
  const grainsRef = useRef([])
  const pointerRef = useRef({ x: 0.5, y: 0.5, strength: 0, lastX: 0.5, lastY: 0.5 })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx2d = canvas.getContext('2d')
    let raf

    const resize = () => {
      canvas.width = canvas.clientWidth * devicePixelRatio
      canvas.height = canvas.clientHeight * devicePixelRatio
    }
    resize()
    window.addEventListener('resize', resize)

    const GRAIN_COUNT = 800
    if (grainsRef.current.length === 0) {
      grainsRef.current = Array.from({ length: GRAIN_COUNT }, () => ({
        x: Math.random(),
        y: Math.random(),
        hue: Math.random() * 360,
      }))
    }

    const freqData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null

    // Chladni nodal function: sin(n*pi*x)*sin(m*pi*y) - sin(m*pi*x)*sin(n*pi*y)
    // n/m modes derived from dominant frequency bin.
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const w = canvas.width
      const h = canvas.height

      ctx2d.fillStyle = 'rgba(6, 6, 14, 0.25)'
      ctx2d.fillRect(0, 0, w, h)

      let n = 3
      let m = 4
      let amplitude = 0.3

      if (running && freqData) {
        analyser.getByteFrequencyData(freqData)
        let maxBin = 0
        let maxVal = 0
        for (let i = 0; i < freqData.length; i++) {
          if (freqData[i] > maxVal) {
            maxVal = freqData[i]
            maxBin = i
          }
        }
        n = 2 + (maxBin % 7)
        m = 3 + ((maxBin * 3) % 9)
        amplitude = Math.min(1, maxVal / 255)
      }

      // Pointer push: decays on its own each frame, independent of audio state.
      const pointer = pointerRef.current
      const pushActive = pointer.strength > 0.002
      if (pointer.strength > 0) pointer.strength *= 0.92

      for (const g of grainsRef.current) {
        const nodal =
          Math.sin(n * Math.PI * g.x) * Math.sin(m * Math.PI * g.y) -
          Math.sin(m * Math.PI * g.x) * Math.sin(n * Math.PI * g.y)

        // Drift toward nodal lines (where nodal ~ 0), jitter scaled by amplitude.
        const pull = 0.002 * (1 - Math.min(1, Math.abs(nodal) * 2))
        g.x += (Math.random() - 0.5) * 0.004 * (0.3 + amplitude) - Math.sign(nodal) * pull
        g.y += (Math.random() - 0.5) * 0.004 * (0.3 + amplitude) - Math.sign(nodal) * pull

        if (pushActive) {
          const dx = g.x - pointer.x
          const dy = g.y - pointer.y
          const distSq = dx * dx + dy * dy
          if (distSq < 0.035) {
            const dist = Math.sqrt(distSq) || 0.001
            const force = pointer.strength * (1 - dist / 0.19)
            g.x += (dx / dist) * force * 0.03
            g.y += (dy / dist) * force * 0.03
          }
        }

        g.x = Math.min(1, Math.max(0, g.x))
        g.y = Math.min(1, Math.max(0, g.y))
        g.hue = (g.hue + 0.05) % 360

        ctx2d.fillStyle = `hsl(${g.hue}, 85%, ${55 + amplitude * 20}%)`
        ctx2d.fillRect(g.x * w, g.y * h, 2 * devicePixelRatio, 2 * devicePixelRatio)
      }
    }
    draw()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [analyser, running])

  const handlePointer = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))

    const pointer = pointerRef.current
    const dx = nx - pointer.lastX
    const dy = ny - pointer.lastY
    const moveDist = Math.sqrt(dx * dx + dy * dy)
    pointer.x = nx
    pointer.y = ny
    pointer.lastX = nx
    pointer.lastY = ny
    pointer.strength = Math.min(1, pointer.strength + Math.max(0.25, moveDist * 6))

    if (onInteract) {
      onInteract(nx, ny, Math.min(1, Math.max(0.3, moveDist * 8)))
    }
  }

  const handlePointerDown = (e) => {
    const pointer = pointerRef.current
    pointer.lastX = pointer.x
    pointer.lastY = pointer.y
    handlePointer(e)
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={(e) => { if (e.buttons > 0) handlePointer(e) }}
    />
  )
}
