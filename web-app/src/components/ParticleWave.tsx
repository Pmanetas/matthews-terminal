import { useEffect, useRef } from 'react'

export function ParticleWave() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number
    let time = 0

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
      ctx.scale(dpr, dpr)
    }

    resize()
    window.addEventListener('resize', resize)

    const cols = 40
    const rows = 30

    const draw = () => {
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight

      ctx.clearRect(0, 0, w, h)

      // Vanishing point — center top area
      const vpX = w * 0.5
      const vpY = h * 0.15

      // Slow time progression
      time += 0.003

      for (let row = 0; row < rows; row++) {
        // Perspective: rows closer to vpY are more compressed
        const rowT = row / (rows - 1)
        // Exponential distribution for perspective depth
        const depth = Math.pow(rowT, 1.8)
        const y = vpY + depth * (h - vpY) * 0.95

        // Row spacing gets wider with depth (perspective)
        const spread = 0.1 + depth * 0.9

        for (let col = 0; col < cols; col++) {
          const colT = (col / (cols - 1)) * 2 - 1 // -1 to 1
          const x = vpX + colT * (w * 0.55) * spread

          // Wave displacement
          const wave = Math.sin(colT * 3 + time * 2 + row * 0.3) *
                       Math.cos(row * 0.2 + time * 1.5) *
                       depth * 2.5

          const finalY = y + wave

          // Dot size: smaller near vanishing point, larger at bottom
          const size = 0.4 + depth * 1.2

          // Opacity: fade near vanishing point
          const opacity = 0.08 + depth * 0.25

          // Very dark purple colour
          ctx.beginPath()
          ctx.arc(x, finalY, size, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(120, 60, 200, ${opacity})`
          ctx.fill()
        }
      }

      animationId = requestAnimationFrame(draw)
    }

    animationId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  )
}
