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

    // Dense grid — lots of tiny dots like 21st.dev
    const cols = 120
    const rows = 80

    const draw = () => {
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight

      ctx.clearRect(0, 0, w, h)

      // Vanishing point at center-top
      const vpX = w * 0.5
      const vpY = h * 0.05

      // Gentle time progression
      time += 0.008

      for (let row = 0; row < rows; row++) {
        const rowT = row / (rows - 1)
        // Perspective depth — exponential for realistic foreshortening
        const depth = Math.pow(rowT, 2.0)
        const y = vpY + depth * (h - vpY)

        // Spread goes beyond screen edges so dots reach all corners
        const spread = 0.02 + depth * 1.2

        for (let col = 0; col < cols; col++) {
          const colT = (col / (cols - 1)) * 2 - 1 // -1 to 1

          // Use full width — w * 0.55 means edges go past screen at bottom rows
          const x = vpX + colT * (w * 0.55) * spread

          // Skip dots that are way off screen
          if (x < -10 || x > w + 10) continue

          // Wave displacement — gentle rolling waves
          const wave = Math.sin(colT * 4 + time + row * 0.15) *
                       Math.sin(row * 0.1 + time * 0.7) *
                       depth * 6

          const finalY = y + wave

          // Tiny dots — max 1px radius
          const size = 0.2 + depth * 0.8

          // Opacity: very faint near top, stronger at bottom
          const opacity = 0.06 + depth * 0.4

          // Dark purple dots
          ctx.beginPath()
          ctx.arc(x, finalY, size, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(100, 50, 180, ${opacity})`
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
