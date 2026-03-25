import { useEffect, useRef } from 'react'

interface VoiceWaveformProps {
  isActive?: boolean
  size?: number
  getAudioLevel?: () => number
}

const BAR_COUNT = 5
const MIN_HEIGHT = 3
const MAX_HEIGHT_RATIO = 0.7 // fraction of canvas height
const BAR_WIDTH = 6
const BAR_GAP = 6

export function VoiceWaveform({ isActive = false, size = 140, getAudioLevel }: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const barsRef = useRef<number[]>(Array(BAR_COUNT).fill(MIN_HEIGHT))
  const getAudioLevelRef = useRef(getAudioLevel)
  getAudioLevelRef.current = getAudioLevel

  const canvasW = size
  const canvasH = Math.round(size * 0.5)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasW * dpr
    canvas.height = canvasH * dpr
    ctx.scale(dpr, dpr)

    const maxBarH = canvasH * MAX_HEIGHT_RATIO
    let time = 0

    const tick = () => {
      time += 0.06
      ctx.clearRect(0, 0, canvasW, canvasH)

      const audioLevel = getAudioLevelRef.current?.() ?? 0
      const bars = barsRef.current
      const totalWidth = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP
      const startX = (canvasW - totalWidth) / 2
      const centerY = canvasH / 2

      for (let i = 0; i < BAR_COUNT; i++) {
        let targetHeight: number

        if (isActive && audioLevel > 0.05) {
          // Audio-reactive: bars dance with audio level
          const phase = time + i * 0.9
          const variation = 0.4 + 0.6 * Math.sin(phase)
          targetHeight = MIN_HEIGHT + (maxBarH - MIN_HEIGHT) * audioLevel * variation
        } else if (isActive) {
          // Active but no audio (thinking/processing): gentle idle wave
          const phase = time * 1.5 + i * 0.8
          targetHeight = MIN_HEIGHT + (maxBarH * 0.3) * (0.5 + 0.5 * Math.sin(phase))
        } else {
          // Inactive: tiny dots
          targetHeight = MIN_HEIGHT
        }

        // Smooth lerp towards target
        bars[i] += (targetHeight - bars[i]) * 0.2

        const x = startX + i * (BAR_WIDTH + BAR_GAP)
        const h = Math.max(MIN_HEIGHT, bars[i])

        // Gradient: violet when active, dim grey when idle
        const alpha = isActive ? 0.95 : 0.25
        const gradient = ctx.createLinearGradient(x, centerY - h / 2, x, centerY + h / 2)
        gradient.addColorStop(0, `rgba(139, 92, 246, ${alpha})`)
        gradient.addColorStop(0.5, `rgba(124, 58, 237, ${alpha})`)
        gradient.addColorStop(1, `rgba(99, 102, 241, ${alpha * 0.6})`)

        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.roundRect(x, centerY - h / 2, BAR_WIDTH, h, BAR_WIDTH / 2)
        ctx.fill()
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isActive, canvasW, canvasH])

  return (
    <div className="flex items-center justify-center" style={{ width: canvasW, height: canvasH }}>
      <canvas
        ref={canvasRef}
        style={{ width: canvasW, height: canvasH }}
      />
    </div>
  )
}
