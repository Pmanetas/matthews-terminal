import { useEffect, useRef, useState } from 'react'

interface SplashScreenProps {
  onDone: () => void
}

interface Particle {
  tx: number
  ty: number
  x: number
  y: number
  size: number
  opacity: number
}

export function SplashScreen({ onDone }: SplashScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [fading, setFading] = useState(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const hasFinishedRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = window.innerWidth
    const h = window.innerHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const sampleText = (text: string, fontSize: number, yOffset: number): { x: number; y: number }[] => {
      const offCanvas = document.createElement('canvas')
      offCanvas.width = w * dpr
      offCanvas.height = h * dpr
      const offCtx = offCanvas.getContext('2d')!
      offCtx.scale(dpr, dpr)

      offCtx.font = `bold ${fontSize}px "SF Pro Display", "Inter", system-ui, -apple-system, sans-serif`
      offCtx.textAlign = 'center'
      offCtx.textBaseline = 'middle'
      offCtx.fillStyle = 'white'
      offCtx.fillText(text, w / 2, h / 2 + yOffset)

      const imageData = offCtx.getImageData(0, 0, w * dpr, h * dpr)
      const points: { x: number; y: number }[] = []
      const gap = Math.max(3, Math.floor(4 * dpr))

      for (let py = 0; py < imageData.height; py += gap) {
        for (let px = 0; px < imageData.width; px += gap) {
          const i = (py * imageData.width + px) * 4
          if (imageData.data[i + 3] > 128) {
            points.push({ x: px / dpr, y: py / dpr })
          }
        }
      }
      return points
    }

    const fontSize = Math.min(w * 0.1, 44)
    const lineGap = fontSize * 0.6

    const line1Points = sampleText('Matthews', fontSize, -lineGap / 2)
    const line2Points = sampleText('Terminal', fontSize, lineGap / 2 + fontSize * 0.1)
    const allPoints = [...line1Points, ...line2Points]

    const particles: Particle[] = allPoints.map(p => ({
      tx: p.x,
      ty: p.y,
      x: Math.random() * w,
      y: Math.random() * h,
      size: 0.8 + Math.random() * 0.8,
      opacity: 0.4 + Math.random() * 0.6,
    }))

    let animationId: number
    const startTime = performance.now()
    const assembleTime = 1200
    const holdTime = 800
    const totalTime = assembleTime + holdTime

    const draw = (now: number) => {
      const elapsed = now - startTime
      ctx.clearRect(0, 0, w, h)

      const assembleProgress = Math.min(1, elapsed / assembleTime)
      const ease = 1 - Math.pow(1 - assembleProgress, 3)

      for (const p of particles) {
        p.x += (p.tx - p.x) * (ease * 0.15 + 0.01)
        p.y += (p.ty - p.y) * (ease * 0.15 + 0.01)

        const alpha = p.opacity * Math.min(1, elapsed / 400)

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(167, 139, 250, ${alpha})`
        ctx.fill()
      }

      if (elapsed < totalTime) {
        animationId = requestAnimationFrame(draw)
      } else if (!hasFinishedRef.current) {
        hasFinishedRef.current = true
        setFading(true)
        setTimeout(() => onDoneRef.current(), 600)
      }
    }

    animationId = requestAnimationFrame(draw)

    return () => cancelAnimationFrame(animationId)
  }, []) // No dependencies — refs handle the callback

  return (
    <div
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center transition-opacity duration-500"
      style={{ opacity: fading ? 0 : 1 }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  )
}
