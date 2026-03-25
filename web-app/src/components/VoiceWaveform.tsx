import { useEffect, useRef } from 'react'

interface VoiceWaveformProps {
  /** Only animate when audio is actually playing */
  isActive?: boolean
  size?: number
  getAudioLevel?: () => number
}

const BAR_COUNT = 24
const BAR_WIDTH = 2.5
const BAR_GAP = 1.5
const MIN_HEIGHT = 2
const MAX_HEIGHT_RATIO = 0.85

export function VoiceWaveform({ isActive = false, size = 140, getAudioLevel }: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const barsRef = useRef<number[]>(Array(BAR_COUNT).fill(MIN_HEIGHT))
  const getAudioLevelRef = useRef(getAudioLevel)
  getAudioLevelRef.current = getAudioLevel

  const canvasW = size
  const canvasH = Math.round(size * 0.35)

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
      time += 0.08
      ctx.clearRect(0, 0, canvasW, canvasH)

      const audioLevel = getAudioLevelRef.current?.() ?? 0
      const bars = barsRef.current
      const totalWidth = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP
      const startX = (canvasW - totalWidth) / 2
      const centerY = canvasH / 2

      for (let i = 0; i < BAR_COUNT; i++) {
        let targetHeight: number

        if (isActive && audioLevel > 0.02) {
          // Audio playing — bars react to actual audio level
          // Centre bars taller, edges shorter (bell curve shape)
          const centre = (BAR_COUNT - 1) / 2
          const dist = Math.abs(i - centre) / centre // 0 at centre, 1 at edges
          const bellCurve = 1 - dist * dist * 0.6 // softer falloff
          const phase = time * 2.5 + i * 0.4
          const variation = 0.5 + 0.5 * Math.sin(phase)
          targetHeight = MIN_HEIGHT + (maxBarH - MIN_HEIGHT) * audioLevel * bellCurve * (0.3 + 0.7 * variation)
        } else {
          // Not speaking — flat/tiny bars
          targetHeight = MIN_HEIGHT
        }

        // Smooth lerp (fast rise, slower fall for natural feel)
        const lerpSpeed = targetHeight > bars[i] ? 0.35 : 0.12
        bars[i] += (targetHeight - bars[i]) * lerpSpeed

        const x = startX + i * (BAR_WIDTH + BAR_GAP)
        const h = Math.max(MIN_HEIGHT, bars[i])

        // Violet gradient
        const alpha = h > MIN_HEIGHT + 1 ? 0.9 : 0.2
        const gradient = ctx.createLinearGradient(x, centerY - h / 2, x, centerY + h / 2)
        gradient.addColorStop(0, `rgba(167, 139, 250, ${alpha})`)
        gradient.addColorStop(0.5, `rgba(139, 92, 246, ${alpha})`)
        gradient.addColorStop(1, `rgba(109, 40, 217, ${alpha * 0.7})`)

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
