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
      // Use the LARGER of offsetHeight and screen.height to guarantee
      // dots cover the full physical screen on iOS (where offsetHeight
      // may not include the home indicator safe area)
      const w = canvas.offsetWidth
      const h = Math.max(canvas.offsetHeight, window.screen.height, window.innerHeight + 50)
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)
    }

    resize()
    window.addEventListener('resize', resize)

    // Dense grid — lots of tiny dots like 21st.dev
    const cols = 120
    const rows = 80

    const draw = () => {
      const w = canvas.offsetWidth
      // Use full screen height for dot rendering, not just canvas CSS height
      const h = Math.max(canvas.offsetHeight, window.screen.height, window.innerHeight + 50)

      ctx.clearRect(0, 0, w, h)

      // Vanishing point — below the header area so dots don't bunch up there
      const vpX = w * 0.5
      const vpY = h * 0.25

      // Gentle time progression
      time += 0.008

      // Skip first 8 rows — they compress into a visible line near the vanishing point
      for (let row = 8; row < rows; row++) {
        const rowT = row / (rows - 1)
        // Perspective depth — exponential for realistic foreshortening
        const depth = Math.pow(rowT, 1.8)
        const y = vpY + depth * (h - vpY)

        // Spread wide — even back rows should cover most of the screen width
        const spread = 0.4 + depth * 2.0

        for (let col = 0; col < cols; col++) {
          const colT = (col / (cols - 1)) * 2 - 1 // -1 to 1

          // Full width spread — edges overflow past screen
          const x = vpX + colT * (w * 0.7) * spread

          // Skip dots that are way off screen
          if (x < -10 || x > w + 10) continue

          // Wave displacement — gentle rolling waves
          const wave = Math.sin(colT * 4 + time + row * 0.15) *
                       Math.sin(row * 0.1 + time * 0.7) *
                       depth * 6

          const finalY = y + wave

          // Tiny dots
          const size = 0.15 + depth * 0.7

          // Opacity: very faint near top, stronger at bottom
          const opacity = 0.04 + depth * 0.38

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
